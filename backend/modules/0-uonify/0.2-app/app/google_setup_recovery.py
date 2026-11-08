"""Explicit recovery choices and official Google actions, scoped to their owner."""
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse
from fastapi import HTTPException
from .google_setup_diagnostics import public_failure
from .google_setup_access import require_retry_access, public_access, authorization_needed


def active(row):
    return bool(row.get('lease_until') and row['lease_until'] > datetime.now(timezone.utc))


def recovery(row, account_email=None):
    if row['status'] not in ('action_required','unknown'):
        return None
    project = row['project_id']
    query = urlencode({'project':project,**({'authuser':account_email} if account_email else {})})
    code, step = row.get('error_code'), row['step']
    access=public_access(row)
    if access and access['status']!='eligible':
        if ((row.get('access_check') or {}).get('failure') or {}).get('code')=='reauthorize':
            return {'kind':'authorization','label':'Volver a conectar Google','url':None,
                'message':'Vuelve a autorizar tu cuenta de Google. Conservaremos el proyecto y tu trabajo.'}
        return {'kind':'diagnostics','label':'Revisar conexión con Uony','url':None,'message':access['message']}
    if row['model_test'] == 'unknown':
        return {'kind':'retry_model','label':'Autorizar una nueva prueba','url':None,
            'message':'La comprobación anterior pudo consumir saldo. Puedes autorizar otra prueba mínima; también puede consumir saldo o generar un coste.'}
    if code == 'reauthorize' and authorization_needed(row):
        return {'kind':'authorization','label':'Volver a conectar Google','url':None,
                'message':'Vuelve a autorizar tu cuenta de Google. Conservaremos el proyecto y tu trabajo.'}
    if code=='reauthorize' and access and access['status']=='eligible':
        return {'kind':'retry_model','label':'Autorizar una nueva prueba','url':None,
            'message':'La autorización de Google está renovada y el acceso al modelo está comprobado. Puedes autorizar una nueva prueba de respuesta.'}
    failure=public_failure(row)
    category=failure['category'] if failure else None
    if category=='api':
        service=(row.get('error_details') or {}).get('service')
        if service not in ('aiplatform.googleapis.com','cloudbilling.googleapis.com','serviceusage.googleapis.com','cloudresourcemanager.googleapis.com'):
            service='aiplatform.googleapis.com'
        kind,path,label='api','/apis/library/'+service,'Activar el servicio en Google'
    elif category=='billing':
        kind,path,label='billing','/billing','Revisar facturación en Google'
    elif category=='policy':
        kind,path,label='permissions','/iam-admin/orgpolicies','Revisar políticas en Google'
    elif code=='quota_project_denied':
        kind,path,label='permissions','/iam-admin/iam','Revisar permisos del proyecto en Google'
    elif category=='quota':
        kind,path,label='model','/iam-admin/quotas','Revisar límites de IA en Google'
    elif category=='connection':
        return {'kind':'model','label':'Revisar la conexión con Uony','url':None,'message':failure['message']}
    elif code in ('model_unavailable','model_not_allowed','model_terms_required'):
        kind,path,label='model','/vertex-ai/publishers/google/model-garden/gemini-3.5-flash','Revisar el modelo en Google'
    elif row['model_test'] == 'failed':
        kind, path, label = 'model','/iam-admin/quotas','Revisar la IA en Google'
        message = 'Google no ha permitido completar la prueba de IA. Revisa el acceso y los límites de uso y después autoriza una nueva comprobación aquí.'
        if code == 'permission_denied':
            return {'kind':'diagnostics','label':'Revisar conexión con Uony','url':None,
                'message':'Google rechazó el acceso al modelo. Revisaremos la conexión sin generar contenido antes de autorizar otra prueba.'}
    elif step == 'billing':
        kind, path, label = 'billing','/billing','Revisar facturación en Google'
        message = 'Comprueba que tu facturación está activa y que tu cuenta puede vincular este proyecto. Después vuelve aquí para continuar.'
    elif step in ('project','project_create','permissions') or code == 'permission_denied':
        kind, path, label = 'permissions','/iam-admin/iam','Revisar permisos en Google'
        message = 'Tu cuenta necesita permiso para preparar y utilizar la IA de este proyecto. Si pertenece a una empresa, su administrador puede ayudarte.'
        if step in ('project','project_create'):
            path, query = '/cloud-resource-manager',urlencode({'authuser':account_email}) if account_email else ''
            message = 'Tu cuenta necesita permiso para crear proyectos. Revísalo en Google o pide ayuda al administrador de tu empresa.'
    elif step == 'model':
        kind, path, label = 'model','/iam-admin/quotas','Revisar disponibilidad de IA en Google'
        message = 'Comprueba los permisos y los límites de uso de la IA en este proyecto. Después vuelve aquí para continuar.'
    else:
        kind, path, label = 'api','/apis/library/aiplatform.googleapis.com','Activar la IA en Google'
        message = 'Activa el servicio de IA de Google en este proyecto y vuelve aquí para continuar con Uony.'
    if failure:
        message=failure['message']
    url = 'https://console.cloud.google.com' + path + ('?' + query if query else '')
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.netloc != 'console.cloud.google.com':
        raise ValueError('Invalid recovery URL')
    return {'kind':kind,'label':label,'message':message,'url':url}


def source_operation(connection, user, body):
    reference = body.retryOf or body.revisionOf
    if not reference:
        return None
    if body.retryOf and body.revisionOf:
        raise HTTPException(400,detail={'error':'setup_recovery_conflict','message':'Elige una sola acción para continuar.'})
    previous = connection.execute('SELECT * FROM google_setup_operations WHERE id=%s',(reference,)).fetchone()
    if not previous or previous['user_id'] != user['id'] or previous['google_subject'] != user['google_subject']:
        raise HTTPException(404,detail={'error':'setup_not_found','message':'Esta preparación no corresponde a tu cuenta.'})
    if active(previous) or connection.execute('''SELECT 1 FROM google_setup_operations
        WHERE user_id=%s AND lease_until>now()''',(user['id'],)).fetchone():
        raise HTTPException(409,detail={'error':'setup_active','message':'La comprobación anterior sigue en marcha. Espera a que termine antes de iniciar otra.'})
    if body.retryOf:
        if previous['model_test'] not in ('unknown','failed') or previous['status'] not in ('unknown','action_required'):
            raise HTTPException(409,detail={'error':'setup_retry_not_needed','message':'Esta comprobación no necesita otra prueba. Retoma su estado guardado.'})
        require_retry_access(previous)
        if body.acceptAdditionalModelCost is not True or body.modelTestConsent is not True:
            raise HTTPException(400,detail={'error':'additional_cost_consent_required',
                'message':'Autoriza expresamente una nueva prueba y su posible consumo adicional.'})
        if any((body.mode,body.projectId,body.billingAccountName,body.configurationApproved)):
            raise HTTPException(400,detail={'error':'setup_retry_choice','message':'La nueva prueba conserva el proyecto y la facturación anteriores.'})
    else:
        if body.mode != 'existing' or body.projectId != previous['project_id'] or not previous['project_resource']:
            raise HTTPException(400,detail={'error':'setup_revision_project','message':'Conserva el proyecto ya creado al revisar su configuración.'})
        if not body.configurationApproved:
            raise HTTPException(400,detail={'error':'setup_approval_required','message':'Confirma la configuración que vamos a revisar.'})
    return previous
