"""Reserve the first message once; derive its result from Uony's own ledger."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Request
from .onboarding import require_user
from .security import require_origin
from .uony_models import Preferences, options, resolve


def validate_message(connection, user, body):
    saved = connection.execute('''SELECT * FROM onboarding_setup_states
        WHERE delivery_request_id=%s''',(body.requestId,)).fetchone()
    if not saved:
        return
    if saved['user_id'] != user['id']:
        raise HTTPException(404,detail={'error':'first_intent_not_found','message':'Esta petición no corresponde a tu cuenta.'})
    altered = (body.threadId != saved['delivery_thread_id'] or body.text != saved['delivery_text']
        or body.model != saved['delivery_model'] or body.effort != saved['delivery_effort']
        or any((body.projectId,body.productContext,body.productAction,body.formResponse,
                body.incidentAction,body.materialAction,body.requirementsAction,body.retryOf,
                body.expectedAssignmentFocus)))
    if altered:
        raise HTTPException(409,detail={'error':'first_intent_conflict',
            'message':'Tu primera petición ya tiene su conversación y su contenido guardados. Retómala sin cambiar esos datos.'})


def delivery(connection, user, saved=None, can_send=False):
    if saved is None:
        saved = connection.execute('SELECT * FROM onboarding_setup_states WHERE user_id=%s',(user['id'],)).fetchone()
    if not saved or not saved.get('delivery_request_id'):
        return None
    previous = connection.execute('''SELECT r.thread_id,r.prompt,r.requested_model,r.effort,
        r.status,r.created_at,j.status AS job_status FROM uony_requests r
        LEFT JOIN uony_conversation_jobs j ON j.user_id=r.user_id AND j.request_id=r.request_id
        WHERE r.user_id=%s AND r.request_id=%s''',(user['id'],saved['delivery_request_id'])).fetchone()
    state, message = 'pending','Tu petición está preparada para enviarse una sola vez.'
    if previous:
        compatible = (previous['thread_id'] == saved['delivery_thread_id'] and previous['prompt'] == saved['delivery_text']
                      and previous['requested_model'] == saved['delivery_model'] and previous['effort'] == saved['delivery_effort'])
        if not compatible:
            state,message = 'blocked','La petición guardada necesita revisión antes de continuar. No la enviaremos de nuevo.'
        elif previous['status'] == 'success':
            state,message = 'complete','Tu petición ya está en la conversación.'
        elif previous['job_status'] in ('queued','running') or (previous['status'] == 'running' and
                previous['created_at'] > datetime.now(timezone.utc)-timedelta(minutes=4)):
            state,message = 'sending','Uony está atendiendo tu petición. No volveremos a enviarla.'
        else:
            state,message = 'unknown','No hemos podido confirmar el resultado. Consulta la conversación antes de autorizar otro intento.'
    elif not can_send:
        state,message = 'blocked','Completa la preparación de tu cuenta y activa tu acceso para continuar con esta petición.'
    return {'requestId':str(saved['delivery_request_id']),'threadId':saved['delivery_thread_id'],
        'text':saved['delivery_text'],'model':saved['delivery_model'],'effort':saved['delivery_effort'],
        'status':state,'message':message}


def routes(settings, database):
    router = APIRouter(prefix='/api/onboarding')

    @router.get('/first-intent')
    def status(request: Request):
        from .onboarding_setup import setup_state
        with database.connect() as connection:
            state = setup_state(connection,require_user(connection,request))
            return {'delivery':state['firstIntentDelivery']}

    @router.post('/first-intent/claim')
    def claim(request: Request, body: Preferences = Preferences()):
        from .onboarding_setup import require_setup_ready
        from .access import workspace_access
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user = require_user(connection,request)
            if not user.get('onboarding_completed_at') or workspace_access(connection,user)['status'] != 'allowed':
                raise HTTPException(403,detail={'error':'access_required','message':'Termina el alta y activa tu acceso antes de enviar tu petición.'})
            require_setup_ready(connection,user)
            saved = connection.execute('SELECT * FROM onboarding_setup_states WHERE user_id=%s FOR UPDATE',(user['id'],)).fetchone()
            if not saved or not saved['first_intent'].strip():
                return {'delivery':None}
            if saved['delivery_request_id']:
                return {'delivery':delivery(connection,user,saved,can_send=True)}
            if len(saved['first_intent']) > 3000:
                raise HTTPException(409,detail={'error':'first_intent_too_long',
                    'message':'Tu petición supera los 3000 caracteres. Acórtala antes de enviarla; el texto original sigue guardado.'})
            resolve(body.model,body.effort,options(connection,user))
            saved = connection.execute('''UPDATE onboarding_setup_states SET delivery_request_id=%s,
                delivery_thread_id=%s,delivery_text=first_intent,delivery_model=%s,delivery_effort=%s,
                delivery_claimed_at=now(),updated_at=now() WHERE user_id=%s RETURNING *''',
                (uuid4(),'onboarding_'+uuid4().hex,body.model,body.effort,user['id'])).fetchone()
            return {'delivery':delivery(connection,user,saved,can_send=True)}

    return router
