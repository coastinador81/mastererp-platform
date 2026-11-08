"""Durable, account-owned setup intent; never retries an uncertain AI call."""
from uuid import uuid4
from fastapi import HTTPException
from psycopg import sql
from psycopg.types.json import Jsonb
from .google_account import require_same_connection
from .onboarding import require_user
from .onboarding_setup import public_operation
from .google_cloud_routes import public_connection
from .google_cloud_provider import CloudError
from .uony_models import FLASH
from .google_setup_recovery import source_operation
from .google_setup_diagnostics import public_failure
from .google_setup_access import access_check, structural


MESSAGES = {
 'permission_denied':'Google no permite completar este paso. Revisa los permisos de tu cuenta.',
 'reauthorize':'Vuelve a conectar Google con la misma cuenta para continuar.',
 'quota_exceeded':'Google ha limitado temporalmente esta operación. Tu progreso está guardado.',
 'billing_required':'Selecciona una cuenta de facturación activa o termina su alta en Google.',
 'project_not_ready':'Google está preparando el proyecto. Puedes continuar en unos instantes.',
 'project_failed':'Google no ha podido crear el proyecto. Revisa la configuración en Google.',
 'model_test_required':'El proyecto está preparado. Autoriza la prueba mínima de IA para comprobar que Uony puede funcionar.',
 'model_test_unknown':'La prueba se interrumpió y no sabemos si Google la procesó. No la repetiremos automáticamente.',
 'model_test_failed':'Google no ha confirmado que este modelo esté disponible. Revisa el acceso y las cuotas del proyecto.',
 'google_unavailable':'No podemos completar este paso con Google ahora. Tu progreso está guardado.',
 'configuration_incomplete':'Google aún no confirma la facturación, la IA o los permisos. Revisa el paso pendiente.',
}


def update(connection, operation, **fields):
    values = {key:Jsonb(value) if key in ('usage','error_details','access_check') and value is not None else value for key,value in fields.items()}
    query = sql.SQL('UPDATE google_setup_operations SET {},updated_at=now() WHERE id=%s').format(
        sql.SQL(',').join(sql.SQL('{}=%s').format(sql.Identifier(key)) for key in values))
    connection.execute(query,(*values.values(),operation['id']))
    operation.update(fields)


def result(connection, user, operation):
    return {'operation':public_operation(operation,user),'connection':public_connection(connection,user)}


def begin(connection, user, body):
    operation = connection.execute('SELECT * FROM google_setup_operations WHERE id=%s',(body.requestId,)).fetchone()
    if operation:
        if operation['user_id'] != user['id'] or operation['google_subject'] != user['google_subject']:
            raise HTTPException(404,detail={'error':'setup_not_found','message':'Esta preparación no corresponde a tu cuenta.'})
        if ((body.mode and body.mode != operation['mode']) or
            (body.retryOf and body.retryOf.lower() != str(operation.get('retry_of') or '')) or
            (body.revisionOf and body.revisionOf.lower() != str(operation.get('revision_of') or '')) or
            (body.projectId and body.projectId != operation['project_id']) or
            (body.billingAccountName and operation['billing_account_name'] and body.billingAccountName != operation['billing_account_name'])):
            raise HTTPException(409,detail={'error':'setup_conflict','message':'Esta preparación corresponde a otra elección. Conservamos el proyecto original.'})
        if body.billingAccountName and not operation['billing_account_name']:
            if body.configurationApproved is not True:
                raise HTTPException(400,detail={'error':'setup_approval_required','message':'Confirma la cuenta de facturación que vamos a utilizar.'})
            update(connection,operation,billing_account_name=body.billingAccountName)
        if body.modelTestConsent and not operation['model_consented_at']:
            operation = connection.execute('''UPDATE google_setup_operations SET model_consented_at=now(),updated_at=now()
                WHERE id=%s RETURNING *''',(operation['id'],)).fetchone()
        return operation
    previous = source_operation(connection,user,body)
    retry = bool(body.retryOf)
    if not retry and (body.mode is None or body.configurationApproved is not True or (body.mode == 'existing' and not body.projectId)):
        raise HTTPException(400,detail={'error':'setup_approval_required','message':'Elige y autoriza el proyecto que vamos a preparar.'})
    count = connection.execute('''SELECT count(*) AS n FROM google_setup_operations WHERE user_id=%s
        AND created_at>now()-interval '24 hours' ''',(user['id'],)).fetchone()['n']
    if count >= 5:
        raise HTTPException(429,detail={'error':'setup_limit','message':'Has alcanzado el límite de cinco preparaciones en 24 horas. Retoma una existente o vuelve a intentarlo más tarde.'})
    if body.acceptAdditionalModelCost and not retry:
        raise HTTPException(400,detail={'error':'setup_retry_required','message':'La autorización adicional debe corresponder a una comprobación anterior.'})
    mode = 'existing' if retry else body.mode
    identifier = previous['project_id'] if retry else 'uonify-' + uuid4().hex[:20] if mode == 'create' else body.projectId
    billing = previous['billing_account_name'] if retry else body.billingAccountName
    return connection.execute('''INSERT INTO google_setup_operations(id,user_id,google_subject,mode,project_id,
        project_name,billing_account_name,model_consented_at,retry_of,revision_of,additional_cost_accepted_at,configuration_approved_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,CASE WHEN %s THEN now() ELSE NULL END,%s,%s,
        CASE WHEN %s THEN now() ELSE NULL END,coalesce(%s,now())) RETURNING *''',
        (body.requestId,user['id'],user['google_subject'],mode,identifier,
         previous['project_name'] if retry else 'Uonify' if mode == 'create' else identifier,
         billing,body.modelTestConsent,body.retryOf,body.revisionOf,retry and body.acceptAdditionalModelCost,
         previous['configuration_approved_at'] if retry else None)).fetchone()


def credentials(connection, request, cipher, provider, operation, refresh=True, for_model=False):
    user = require_user(connection,request)
    connection.execute("UPDATE google_setup_operations SET lease_until=now()+interval '2 minutes' WHERE id=%s",(operation['id'],))
    cloud = connection.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s FOR UPDATE',(user['id'],)).fetchone()
    if not cloud or cloud['status'] != 'connected':
        raise CloudError('reauthorize')
    require_same_connection(user,cloud)
    if operation['google_subject'] != user['google_subject']:
        raise CloudError('reauthorize')
    if for_model and (cloud['project_id'] != operation['project_id'] or not (cloud['project_check'] or {}).get('ready')):
        raise CloudError('configuration_incomplete')
    return user, provider.refresh(cipher.decrypt(cloud['refresh_encrypted'].encode()).decode()) if refresh else None


def configure(connection, request, cipher, provider, operation):
    user, token = credentials(connection,request,cipher,provider,operation)
    identifier = operation['project_id']
    if operation.get('retry_of'):
        update(connection,operation,step='model')
        project = provider.project(token,identifier)
        if not project:
            raise CloudError('permission_denied')
        checks = provider.check(token,project)
        current = connection.execute('SELECT project_id FROM google_cloud_connections WHERE user_id=%s',(user['id'],)).fetchone()
        if current['project_id'] != identifier:
            raise CloudError('configuration_incomplete')
        connection.execute('''UPDATE google_cloud_connections SET project_check=%s,checked_at=now()
            WHERE user_id=%s''',(Jsonb(checks),user['id']))
        update(connection,operation,step='model',project_resource=project['resource'])
        if not checks.get('ready'):
            raise CloudError('configuration_incomplete')
        connection.commit()
        return True
    first_creation = (operation['mode'] == 'create' and operation['step'] == 'project'
                      and not operation['project_resource'] and not operation['external_operation'])
    if first_creation:
        # A GET for a not-yet-existent project can return 403 rather than 404.
        # Reserve its ID and a durable attempt marker before the first POST;
        # subsequent requests reconcile that exact resource/operation.
        update(connection,operation,step='project_create',status='preparing')
        connection.commit()
        user, token = credentials(connection,request,cipher,provider,operation)
        try:
            name = provider.create_project(token,identifier)
            update(connection,operation,external_operation=name,message=MESSAGES['project_not_ready'])
        except CloudError as error:
            if error.code != 'already_exists':
                raise
        connection.commit()
        user, token = credentials(connection,request,cipher,provider,operation)
    if operation['external_operation']:
        if not provider.operation(token,operation['external_operation']):
            update(connection,operation,status='preparing',message=MESSAGES['project_not_ready'])
            return False
    project = provider.project(token,identifier)
    if not project:
        if operation['mode'] != 'create':
            raise CloudError('permission_denied')
        if not first_creation and not operation['external_operation']:
            # A confirmed 404 after an interrupted create permits the same-ID
            # request again. Google cannot create two projects with that ID.
            connection.commit()
            user, token = credentials(connection,request,cipher,provider,operation)
            try:
                name = provider.create_project(token,identifier)
                update(connection,operation,external_operation=name)
            except CloudError as error:
                if error.code != 'already_exists':
                    raise
        update(connection,operation,status='preparing',message=MESSAGES['project_not_ready'])
        return False
    update(connection,operation,project_name=project['name'],project_resource=project['resource'],step='billing')
    connection.commit()
    user, token = credentials(connection,request,cipher,provider,operation)
    billing = provider.billing_info(token,identifier)
    chosen = operation['billing_account_name']
    if chosen and (billing['name'] != chosen or not billing['enabled']):
        if not any(account['name'] == chosen for account in provider.billing_accounts(token)):
            raise CloudError('permission_denied')
        provider.link_billing(token,identifier,chosen)
        billing = provider.billing_info(token,identifier)
    if not billing['enabled']:
        raise CloudError('billing_required')
    update(connection,operation,step='services')
    checks = provider.check(token,project)
    if checks.get('vertex') != 'enabled':
        provider.enable_vertex(token,project['resource'])
        checks = provider.check(token,project)
    connection.execute('''UPDATE google_cloud_connections SET project_id=%s,project_name=%s,project_check=%s,
        checked_at=now() WHERE user_id=%s AND google_subject=%s''',
        (identifier,project['name'],Jsonb(checks),user['id'],user['google_subject']))
    if not checks.get('ready'):
        step = ('billing' if checks.get('billing') != 'enabled' else
                'services' if checks.get('vertex') != 'enabled' else 'permissions')
        update(connection,operation,step=step)
        raise CloudError('configuration_incomplete')
    update(connection,operation,step='model')
    connection.commit()
    return True


def check_model(connection, request, cipher, provider, operation):
    user, token = credentials(connection,request,cipher,provider,operation,for_model=True)
    if operation['model_test'] in ('pending','unknown'):
        update(connection,operation,model_test='unknown',status='unknown',message=MESSAGES['model_test_unknown'])
        return
    if operation['model_test'] == 'failed':
        update(connection,operation,status='action_required',message=MESSAGES['model_test_failed'])
        return
    # Reuse a confirmed capability for this exact account/project/model/effort.
    verified = connection.execute('''SELECT 1 FROM uony_model_checks WHERE user_id=%s AND project_id=%s
        AND google_subject=%s AND model=%s AND effort='medium' ''',
        (user['id'],operation['project_id'],user['google_subject'],FLASH)).fetchone()
    if verified:
        update(connection,operation,model_test='passed',status='ready',step='complete',error_code=None,error_details=None,message='Tu IA está preparada para trabajar con Uony.')
        return
    uncertain = connection.execute('''SELECT 1 FROM google_setup_operations WHERE user_id=%s
        AND google_subject=%s AND project_id=%s AND id<>%s AND model_test IN ('pending','unknown')''',
        (user['id'],user['google_subject'],operation['project_id'],operation['id'])).fetchone()
    if uncertain and not (operation.get('retry_of') and operation.get('additional_cost_accepted_at')):
        update(connection,operation,model_test='unknown',status='unknown',message=MESSAGES['model_test_unknown'])
        return
    if not operation['model_consented_at']:
        raise CloudError('model_test_required')
    cloud=connection.execute('SELECT project_check FROM google_cloud_connections WHERE user_id=%s',(user['id'],)).fetchone()
    access=access_check(connection,operation,provider,token,cloud['project_check'] or {})
    if access['status']!='eligible':
        update(connection,operation,status='preparing' if access['status']=='waiting' else 'action_required',
            step='model',error_code='model_access_pending' if access['status']=='waiting' else 'model_access_denied',
            message=access['message'])
        return
    update(connection,operation,model_test='pending',step='model',message='Comprobando la conexión de Uony con una prueba mínima.')
    connection.commit()  # At-most-once boundary: durable before the paid request.
    try:
        # The already refreshed token remains local. Only ownership/readiness
        # checks run after the durable boundary, before any paid request.
        user, _ = credentials(connection,request,cipher,provider,operation,refresh=False,for_model=True)
    except (CloudError,HTTPException):
        connection.execute('''UPDATE google_setup_operations SET model_test='not_started',status='action_required',
            error_code='model_not_sent',message=%s WHERE id=%s AND EXISTS(SELECT 1 FROM users
            WHERE users.id=google_setup_operations.user_id AND users.deletion_requested_at IS NULL)''',
            ('La conexión cambió antes de la prueba. No se ha enviado ninguna llamada de IA.',operation['id']))
        operation.update(model_test='not_started',status='action_required')
        raise
    try:
        usage = provider.probe_model(token,operation['project_id'])
    except CloudError as error:
        ambiguous = error.code in ('google_unavailable','invalid_response')
        guidance=public_failure({'error_code':error.code,'status':'action_required','step':'model',
            'model_test':'unknown' if ambiguous else 'failed','error_details':getattr(error,'setup_diagnostic',None)})
        if error.code=='reauthorize':
            connection.execute("UPDATE google_cloud_connections SET status='reauthorize' WHERE user_id=%s",(user['id'],))
        # A successful CountTokens response is not proof a later generation was
        # accepted. A rejection invalidates that eligibility before any retry.
        rejected={'error_code':error.code,'error_details':getattr(error,'setup_diagnostic',None)}
        if structural(rejected):
            update(connection,operation,access_check=None)
        update(connection,operation,model_test='unknown' if ambiguous else 'failed',
            status='unknown' if ambiguous else 'action_required',error_code=error.code,
            error_details=getattr(error,'setup_diagnostic',None),
            message=guidance['message'] if guidance else MESSAGES['model_test_unknown' if ambiguous else 'model_test_failed'])
        return
    # Same locked owner/connection is still current; never publish a capability for another project.
    connection.execute('''INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort)
        VALUES(%s,%s,%s,%s,'medium') ON CONFLICT(user_id,project_id,google_subject,model,effort)
        DO UPDATE SET checked_at=now()''',(user['id'],operation['project_id'],user['google_subject'],FLASH))
    update(connection,operation,model_test='passed',usage=usage,status='ready',step='complete',
           error_code=None,error_details=None,message='Tu IA está preparada para trabajar con Uony.')
