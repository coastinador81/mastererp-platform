"""Read-only model readiness, separate from a consented generation and its result."""
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from psycopg.types.json import Jsonb
from .google_cloud_provider import CloudError
from .uony_models import FLASH

DELAYS=(15,30,60,120,240,300)
FRESHNESS=timedelta(minutes=10)


def instant(value):
    try:
        parsed=datetime.fromisoformat(value) if isinstance(value,str) else None
        return parsed if parsed and parsed.tzinfo else None
    except ValueError:
        return None


def bound(check, row):
    return bool(check and check.get('projectId')==row['project_id']
        and check.get('googleSubject')==row['google_subject']
        and check.get('userId')==str(row['user_id'])
        and check.get('model')==FLASH and check.get('location')=='global')


def eligible(row):
    check=row.get('access_check') or {}
    timestamp=instant(check.get('checkedAt'))
    return bool(bound(check,row) and check.get('status')=='eligible' and timestamp
        and datetime.now(timezone.utc)-FRESHNESS<=timestamp<=datetime.now(timezone.utc))


def structural(row):
    details=row.get('error_details') or {}
    return (details.get('httpStatus') in (400,401,403,404,429)
        or row.get('error_code') in ('reauthorize','permission_denied','service_disabled','billing_required',
            'quota_project_denied','organization_policy','model_not_allowed','model_terms_required',
            'model_access_denied','model_access_pending','configuration_incomplete','model_unavailable'))


def authorization_needed(row):
    check=row.get('access_check') or {}
    current=bound(check,row)
    renewed=current and instant(check.get('authorizationRenewedAt'))
    return (row.get('error_code')=='reauthorize' and not renewed) or (current
        and (check.get('failure') or {}).get('code')=='reauthorize')


def authorization_renewed(connection,user,project_id):
    """Only the verified same-sub OAuth callback may invalidate an auth failure."""
    if not project_id:
        return
    rows=connection.execute('''SELECT * FROM google_setup_operations WHERE user_id=%s
        AND google_subject=%s AND project_id=%s AND model_test IN ('not_started','failed','unknown')
        AND (lease_until IS NULL OR lease_until<=now()) FOR UPDATE''',
        (user['id'],user['google_subject'],project_id)).fetchall()
    now=datetime.now(timezone.utc).isoformat()
    for row in rows:
        if not authorization_needed(row):
            continue
        check={'status':'unresolved','checkedAt':now,'nextCheckAt':None,'attempts':0,
            'projectId':row['project_id'],'googleSubject':row['google_subject'],
            'userId':str(row['user_id']),'model':FLASH,'location':'global',
            'authorizationRenewedAt':now,
            'message':'Autorización renovada. Revisaremos el acceso al modelo sin generar contenido.'}
        persist(connection,row,check)


def retry_allowed(row):
    if authorization_needed(row):
        return False
    check=row.get('access_check') or {}
    if bound(check,row) and check.get('status')!='eligible':
        return False
    return not structural(row) or eligible(row)


def public_access(row):
    check=row.get('access_check') or {}
    if not bound(check,row):
        return None
    return {key:check.get(key) for key in ('status','checkedAt','nextCheckAt','message')}


def can_diagnose(row):
    lease=row.get('lease_until')
    return bool(row.get('project_resource') and row['model_test'] in ('not_started','failed','unknown')
        and not (lease and lease>datetime.now(timezone.utc)) and not eligible(row)
        and not authorization_needed(row))


def persist(connection,row,check):
    connection.execute('UPDATE google_setup_operations SET access_check=%s,updated_at=now() WHERE id=%s',
        (Jsonb(check),row['id']))
    row['access_check']=check
    return check


def access_check(connection,row,provider,token,checks,force=False):
    """CountTokens does not generate content; it never establishes a capability."""
    now=datetime.now(timezone.utc)
    previous=row.get('access_check') or {}
    if not bound(previous,row):
        previous={}
    if not force and eligible(row):
        return previous
    next_check=instant(previous.get('nextCheckAt'))
    if next_check and now<next_check:
        return previous
    attempts=int(previous.get('attempts',0))+1
    check={'projectId':row['project_id'],'googleSubject':row['google_subject'],
        'userId':str(row['user_id']),'model':FLASH,'location':'global',
        'checkedAt':now.isoformat(),'nextCheckAt':None,'attempts':attempts}
    if instant(previous.get('authorizationRenewedAt')):
        check['authorizationRenewedAt']=previous['authorizationRenewedAt']
    if not checks.get('ready'):
        check.update(status='blocked',nextCheckAt=(now+timedelta(seconds=30)).isoformat(),message='La facturación, el servicio de IA o los permisos de Google todavía no están preparados. Conservamos tu proyecto y tu progreso.')
        return persist(connection,row,check)
    try:
        provider.check_model_access(token,row['project_id'])
        check.update(status='eligible',message='Google ha confirmado el acceso al modelo sin generar contenido. La prueba de respuesta se realiza por separado y solo con tu autorización.')
    except CloudError as error:
        detail=getattr(error,'setup_diagnostic',{}) or {}
        check['failure']={'code':error.code,'details':detail}
        if error.code=='reauthorize':
            connection.execute("UPDATE google_cloud_connections SET status='reauthorize' WHERE user_id=%s",(row['user_id'],))
        newly_created=connection.execute('''SELECT created_at FROM google_setup_operations
            WHERE user_id=%s AND google_subject=%s AND project_id=%s AND mode='create'
            ORDER BY created_at LIMIT 1''',(row['user_id'],row['google_subject'],row['project_id'])).fetchone()
        message=str(detail.get('providerMessage','')).lower()
        iam_denied=(detail.get('reason')=='IAM_PERMISSION_DENIED'
            or (detail.get('httpStatus')==403 and 'aiplatform.endpoints.predict' in message and 'denied' in message))
        fresh=bool(newly_created and now-newly_created['created_at']<timedelta(minutes=45))
        if error.code=='permission_denied' and iam_denied and fresh and attempts<=len(DELAYS):
            check.update(status='waiting',nextCheckAt=(now+timedelta(seconds=DELAYS[attempts-1])).isoformat(),
                message='El proyecto es nuevo y Google todavía no confirma el acceso a la IA. Puede estar terminando de prepararlo. Volveremos a comprobar solo la conexión, sin generar contenido ni repetir la prueba de respuesta.')
        elif error.code in ('permission_denied','google_unavailable','invalid_response'):
            check.update(status='unresolved',nextCheckAt=(now+timedelta(seconds=30)).isoformat(),message='La configuración del proyecto está activa, pero todavía no podemos confirmar el acceso al modelo. Conservamos tu progreso; Uonify debe revisar esta conexión antes de repetir la prueba de IA.')
        else:
            from .google_setup_diagnostics import public_failure
            failure=public_failure({'error_code':error.code,'status':'action_required'})
            check.update(status='blocked',nextCheckAt=(now+timedelta(seconds=30)).isoformat(),message=failure['message'] if failure else 'Google no permite utilizar este modelo todavía. Conservamos tu proyecto y el resultado anterior.')
    return persist(connection,row,check)


def require_retry_access(row):
    if not retry_allowed(row):
        raise HTTPException(409,detail={'error':'setup_diagnostics_required',
            'message':'Primero revisaremos la conexión con Google sin generar contenido. La prueba anterior y tu proyecto se conservan.'})
