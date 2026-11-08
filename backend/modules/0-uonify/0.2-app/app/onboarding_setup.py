"""Preparation is separate from the subscription's permission to use tools."""
from typing import Literal, TypedDict
from fastapi import APIRouter, HTTPException, Request
from pydantic import Field
from .google_account import connection_matches
from .onboarding import StrictBody, onboarding_state, require_user
from .security import require_origin
from .uony_models import FLASH
from .google_setup_recovery import active, recovery
from .google_setup_diagnostics import public_failure
from .onboarding_first_intent import delivery
from .google_setup_access import public_access, can_diagnose, retry_allowed, authorization_needed


class Activation(TypedDict):
    basis: Literal['trial', 'paid']
    endsAt: str


def preparation_allowed(connection, user):
    return onboarding_state(connection,user)['onboarding']['step'] == 'pending'


def preparation_user(connection, request):
    user = require_user(connection, request)
    if not preparation_allowed(connection,user):
        raise HTTPException(403, detail={'error':'profile_required',
            'message':'Completa primero los datos de tu cuenta para conectar Google.'})
    return user


def public_operation(row, user=None):
    if not row:
        return None
    return {'id':str(row['id']), 'status':row['status'], 'step':row['step'],
        'projectId':row['project_id'], 'projectName':row['project_name'],
        'mode':row['mode'],'billingAccountName':row['billing_account_name'],
        'modelTestConsent':bool(row['model_consented_at']),
        'retryOf':str(row['retry_of']) if row.get('retry_of') else None,
        'revisionOf':str(row['revision_of']) if row.get('revision_of') else None,
        'additionalModelCostAccepted':bool(row.get('additional_cost_accepted_at')),
        'canRetryModel':row['model_test'] in ('unknown','failed') and not active(row) and retry_allowed(row),
        'canDiagnose':can_diagnose(row) and not active(row),'accessCheck':public_access(row),
        'recovery':recovery(row,user['email'] if user else None),
        'errorDetails':public_failure(row),
        'message':row['message'], 'canResume':row['model_test'] not in ('pending','unknown','failed')
            and not (public_access(row) and public_access(row)['status']!='eligible')
            and not authorization_needed(row),
        'modelTest':row['model_test']}


def recover_interrupted_models(connection, user):
    # A process can disappear after committing the at-most-once boundary.
    # Expiry is not evidence that Google did not process the paid request.
    connection.execute('''UPDATE google_setup_operations SET model_test='unknown',status='unknown',
        error_code='model_test_unknown',message=%s,lease_until=NULL,updated_at=now()
        WHERE user_id=%s AND model_test='pending' AND (lease_until IS NULL OR lease_until<=now())''',
        ('La prueba se interrumpió y no sabemos si Google la procesó. No la repetiremos automáticamente.',user['id']))


def setup_state(connection, user):
    recover_interrupted_models(connection,user)
    cloud = connection.execute('SELECT * FROM google_cloud_connections WHERE user_id=%s', (user['id'],)).fetchone()
    drive = connection.execute('SELECT * FROM google_drive_connections WHERE user_id=%s', (user['id'],)).fetchone()
    connected = connection_matches(user, cloud) and cloud['status'] == 'connected'
    drive_connected = connection_matches(user, drive) and drive['status'] == 'connected'
    deferred = bool(connection.execute('SELECT 1 FROM drive_onboarding_preferences WHERE user_id=%s', (user['id'],)).fetchone())
    project = cloud['project_id'] if connected else None
    checked = bool(connected and project and (cloud['project_check'] or {}).get('ready'))
    ai_ready = bool(checked and connection.execute('''SELECT 1 FROM uony_model_checks WHERE user_id=%s
        AND google_subject=%s AND project_id=%s AND model=%s AND effort='medium' ''',
        (user['id'],user['google_subject'],project,FLASH)).fetchone())
    profile_ready = onboarding_state(connection,user)['onboarding']['step'] == 'pending'
    ready = bool(profile_ready and (drive_connected or deferred) and ai_ready)
    period = connection.execute('''SELECT kind,ends_at FROM access_periods WHERE user_id=%s AND revoked_at IS NULL
        AND starts_at<=now() AND ends_at>now() ORDER BY ends_at DESC LIMIT 1''',(user['id'],)).fetchone()
    activation: Activation | None = {'basis':period['kind'],'endsAt':period['ends_at'].isoformat()} if period else None
    # Payment reaches the recoverable closing summary. Only Continue completes
    # onboarding and permits the first message to be claimed or sent.
    step = ('profile' if not profile_ready else 'drive' if not (drive_connected or deferred) else
            'cloud' if not ai_ready else 'complete' if period else 'subscription')
    saved = connection.execute('SELECT * FROM onboarding_setup_states WHERE user_id=%s',(user['id'],)).fetchone()
    operation = connection.execute('''SELECT * FROM google_setup_operations WHERE user_id=%s
        AND google_subject=%s ORDER BY created_at DESC LIMIT 1''',(user['id'],user['google_subject'])).fetchone()
    return {'step':step,'version':1,'drive':{'connected':bool(drive_connected),'deferred':deferred},
        'cloud':{'connected':bool(connected),'ready':ai_ready,'projectId':project,
                 'projectName':cloud['project_name'] if connected else None,'operation':public_operation(operation,user)},
        'setupReady':ready,'aiReady':ai_ready,'activation':activation,'firstIntent':saved['first_intent'] if saved else '',
        'firstIntentDelivery':delivery(connection,user,saved,can_send=ready and bool(period) and bool(user.get('onboarding_completed_at')))}


def setup_ready(connection, user):
    return setup_state(connection,user)['setupReady']


def require_setup_ready(connection, user):
    state = setup_state(connection,user)
    if not state['setupReady']:
        raise HTTPException(409,detail={'error':'setup_required',
            'message':'Prepara la conexión de Google antes de activar tu suscripción.','setup':state})
    return state


class IntentBody(StrictBody):
    firstIntent: str = Field(max_length=4000)


def routes(settings, database):
    router = APIRouter(prefix='/api/onboarding')

    @router.get('/setup')
    def status(request: Request):
        with database.connect() as connection:
            return setup_state(connection,require_user(connection,request))

    @router.put('/setup')
    def intent(body: IntentBody, request: Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user = require_user(connection,request)
            saved = connection.execute('SELECT * FROM onboarding_setup_states WHERE user_id=%s',(user['id'],)).fetchone()
            if saved and saved.get('delivery_request_id') and saved['first_intent'] != body.firstIntent:
                raise HTTPException(409,detail={'error':'first_intent_already_claimed',
                    'message':'Tu primera petición ya está preparada. Continúa desde la conversación para cambiarla o añadir otra.'})
            connection.execute('''INSERT INTO onboarding_setup_states(user_id,first_intent) VALUES(%s,%s)
                ON CONFLICT(user_id) DO UPDATE SET first_intent=EXCLUDED.first_intent,updated_at=now()''',
                (user['id'],body.firstIntent))
            return setup_state(connection,user)

    return router
