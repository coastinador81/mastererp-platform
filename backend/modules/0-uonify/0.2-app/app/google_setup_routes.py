"""Explicit preparation endpoints; these do not unlock normal paid tools."""
from typing import Literal
from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException, Request
from pydantic import Field
from psycopg.types.json import Jsonb
from .onboarding import StrictBody
from .onboarding_setup import preparation_user, recover_interrupted_models
from .google_account import require_same_connection
from .google_cloud_routes import public_connection
from .google_cloud_provider import CloudError
from .google_setup_provider import GoogleSetupProvider
from .google_setup_operations import begin, configure, check_model, update, result, MESSAGES
from .google_setup_operations import credentials
from .google_setup_access import access_check, eligible, instant
from datetime import datetime, timedelta, timezone
from .security import require_origin
from .uony_models import FLASH
from .google_setup_diagnostics import public_failure

UUID_PATTERN = r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

class SetupBody(StrictBody):
    requestId: str = Field(pattern=UUID_PATTERN)
    mode: Literal['create','existing'] | None = None
    projectId: str | None = Field(default=None,pattern=r'^[a-z][a-z0-9-]{4,28}[a-z0-9]$')
    billingAccountName: str | None = Field(default=None,pattern=r'^billingAccounts/[A-Za-z0-9-]+$')
    configurationApproved: bool = False
    modelTestConsent: bool = False
    retryOf: str | None = Field(default=None,pattern=UUID_PATTERN)
    revisionOf: str | None = Field(default=None,pattern=UUID_PATTERN)
    acceptAdditionalModelCost: bool = False


def routes(settings, database, cloud):
    router = APIRouter(prefix='/api/connections/google-cloud')
    cipher = Fernet(settings.encryption_key)
    provider = GoogleSetupProvider(cloud)

    @router.get('/setup')
    def status(request: Request):
        with database.connect() as connection:
            user = preparation_user(connection,request)
            recover_interrupted_models(connection,user)
            operation = connection.execute('''SELECT * FROM google_setup_operations WHERE user_id=%s
                AND google_subject=%s ORDER BY created_at DESC LIMIT 1''',(user['id'],user['google_subject'])).fetchone()
            return result(connection,user,operation)

    @router.get('/billing-accounts')
    def accounts(request: Request):
        with database.connect() as connection:
            user = preparation_user(connection,request)
            row = connection.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s',(user['id'],)).fetchone()
            if not row or row['status'] != 'connected':
                raise HTTPException(409,detail={'error':'not_connected','message':'Conecta Google para elegir tu facturación.'})
            require_same_connection(user,row)
            try:
                token = provider.refresh(cipher.decrypt(row['refresh_encrypted'].encode()).decode())
                return {'accounts':provider.billing_accounts(token)}
            except CloudError as error:
                raise HTTPException(409 if error.code == 'reauthorize' else 503,
                    detail={'error':error.code,'message':MESSAGES.get(error.code,MESSAGES['google_unavailable'])}) from None

    @router.post('/setup/{operation_id}/diagnostics')
    def diagnose(operation_id: str, request: Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user=preparation_user(connection,request)
            locked=connection.execute('SELECT pg_try_advisory_lock(hashtextextended(%s,7292026)) AS locked',
                (str(user['id']),)).fetchone()['locked']
            if not locked:
                raise HTTPException(409,detail={'error':'setup_busy','message':'La revisión de Google ya está en marcha.'})
            owns_lease=False
            try:
                operation=connection.execute('SELECT * FROM google_setup_operations WHERE id::text=%s',(operation_id,)).fetchone()
                if not operation or operation['user_id']!=user['id'] or operation['google_subject']!=user['google_subject']:
                    raise HTTPException(404,detail={'error':'setup_not_found','message':'Esta preparación no corresponde a tu cuenta.'})
                if operation.get('lease_until') and operation['lease_until']>datetime.now(timezone.utc):
                    raise HTTPException(409,detail={'error':'setup_active','message':'La comprobación anterior sigue en marcha.'})
                recover_interrupted_models(connection,user)
                operation=connection.execute('SELECT * FROM google_setup_operations WHERE id=%s',(operation['id'],)).fetchone()
                cloud_row=connection.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s FOR UPDATE',(user['id'],)).fetchone()
                if not cloud_row or cloud_row['status']!='connected':
                    raise HTTPException(409,detail={'error':'not_connected','message':'Conecta Google para revisar esta preparación.'})
                require_same_connection(user,cloud_row)
                if cloud_row['project_id']!=operation['project_id'] or not operation.get('project_resource'):
                    raise HTTPException(409,detail={'error':'setup_project_changed','message':'El proyecto conectado ha cambiado. Conservamos la preparación anterior.'})
                if operation['model_test']=='passed':
                    return result(connection,user,operation)
                saved=operation.get('access_check') or {}
                next_check=instant(saved.get('nextCheckAt'))
                if eligible(operation) or (next_check and datetime.now(timezone.utc)<next_check):
                    return result(connection,user,operation)
                owns_lease=True
                try:
                    user,token=credentials(connection,request,cipher,provider,operation)
                    project=provider.project(token,operation['project_id'])
                    if not project:
                        raise CloudError('permission_denied')
                    checks=provider.check(token,project)
                    connection.execute('UPDATE google_cloud_connections SET project_check=%s,checked_at=now() WHERE user_id=%s',
                        (Jsonb(checks),user['id']))
                    checked=access_check(connection,operation,provider,token,checks)
                except CloudError as error:
                    if error.code=='reauthorize':
                        connection.execute("UPDATE google_cloud_connections SET status='reauthorize' WHERE user_id=%s",(user['id'],))
                    # Keep the original generation error. Diagnostic failures
                    # are recorded separately and cannot manufacture readiness.
                    checked={'status':'unresolved','checkedAt':datetime.now(timezone.utc).isoformat(),
                        'nextCheckAt':(datetime.now(timezone.utc)+timedelta(seconds=30)).isoformat(),
                        'attempts':int(saved.get('attempts',0))+1,
                        'message':'No hemos podido revisar esta conexión de Google. Tu progreso y el resultado anterior se conservan.',
                        'projectId':operation['project_id'],'userId':str(user['id']),
                        'googleSubject':user['google_subject'],'model':FLASH,'location':'global',
                        'failure':{'code':error.code,'details':getattr(error,'setup_diagnostic',None)}}
                    update(connection,operation,access_check=checked)
                if operation['model_test']=='not_started':
                    resumable=checked['status']=='waiting' or (checked['status']=='eligible' and operation['model_consented_at'])
                    update(connection,operation,status='preparing' if resumable else 'action_required',
                        message=checked['message'])
                return result(connection,user,operation)
            finally:
                if connection.info.transaction_status.name=='INERROR':
                    connection.rollback()
                if owns_lease:
                    connection.execute('UPDATE google_setup_operations SET lease_until=NULL WHERE id=%s',(operation['id'],))
                connection.execute('SELECT pg_advisory_unlock(hashtextextended(%s,7292026))',(str(user['id']),))

    @router.post('/setup')
    def prepare(body: SetupBody, request: Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user = preparation_user(connection,request)
            locked = connection.execute('SELECT pg_try_advisory_lock(hashtextextended(%s,7292026)) AS locked',
                                         (str(user['id']),)).fetchone()['locked']
            if not locked:
                raise HTTPException(409,detail={'error':'setup_busy','message':'La preparación ya está en marcha. Tu progreso está guardado.'})
            try:
                row = connection.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s',(user['id'],)).fetchone()
                if not row or row['status'] != 'connected':
                    raise HTTPException(409,detail={'error':'not_connected','message':'Conecta primero tu cuenta de Google.'})
                require_same_connection(user,row)
                recover_interrupted_models(connection,user)
                operation = begin(connection,user,body)
                connection.commit()
                if operation['model_test'] in ('failed','unknown'):
                    # A failed/uncertain request is a durable result. Only a
                    # separately consented retry gets another operation ID.
                    return result(connection,user,operation)
                confirmed = operation['status'] == 'ready' and row['project_id'] == operation['project_id'] and (row['project_check'] or {}).get('ready')
                if confirmed and connection.execute('''SELECT 1 FROM uony_model_checks WHERE user_id=%s
                    AND project_id=%s AND google_subject=%s AND model=%s AND effort='medium' ''',
                    (user['id'],row['project_id'],user['google_subject'],FLASH)).fetchone():
                    return result(connection,user,operation)
                try:
                    if configure(connection,request,cipher,provider,operation):
                        check_model(connection,request,cipher,provider,operation)
                except CloudError as error:
                    if error.code == 'reauthorize':
                        connection.execute("UPDATE google_cloud_connections SET status='reauthorize' WHERE user_id=%s",(user['id'],))
                    guidance=public_failure({'error_code':error.code,'status':'action_required'})
                    update(connection,operation,status='preparing' if error.code == 'project_not_ready' else 'action_required',
                        error_code=error.code,error_details=getattr(error,'setup_diagnostic',None),
                        message=guidance['message'] if guidance else MESSAGES.get(error.code,MESSAGES['google_unavailable']))
                return result(connection,user,operation)
            finally:
                if connection.info.transaction_status.name == 'INERROR':
                    connection.rollback()
                if 'operation' in locals():
                    connection.execute('''UPDATE google_setup_operations SET lease_until=NULL WHERE id=%s
                        AND EXISTS(SELECT 1 FROM users WHERE users.id=google_setup_operations.user_id
                        AND users.deletion_requested_at IS NULL)''',(operation['id'],))
                connection.execute('SELECT pg_advisory_unlock(hashtextextended(%s,7292026))',(str(user['id']),))

    return router
