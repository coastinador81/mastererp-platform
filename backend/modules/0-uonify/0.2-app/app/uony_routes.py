"""Conversación real: acceso, aislamiento, historial e idempotencia en PostgreSQL."""
from uuid import UUID
from typing import get_args
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import Field, model_validator
from cryptography.fernet import Fernet
from psycopg.types.json import Jsonb
from .onboarding import StrictBody, require_user
from .access import workspace_access
from .security import require_origin
from .google_cloud_provider import CloudError, SCOPE
from .uony_provider import MODEL, LOCATION
from .google_account import connection_matches
from .uony_projects import ensure_thread
from .blender_store import status as blender_status
from .products import find
from .product_guide import FormResponse, submit as submit_guide, finalise_tools, introduction
from .uony_models import Preferences, Model, Effort, MODELS, EFFORTS, POLICY, options, resolve
from .incident_guide import IncidentAction, saved_form as incident_form, execute as execute_incident
from .product_materials_guide import MaterialAction, saved_form as material_form, execute as execute_material
from .product_reasoning_guide import RequirementsAction, execute as execute_requirements
from .uony_context import ProductContext, cloud_selection, conversation_context
from .uony_context_routes import routes as context_routes
from .google_billing_routes import routes as google_billing_routes
from .onboarding_first_intent import validate_message as validate_first_intent
from .product_memory import ProductAction, execute_action as execute_product_action, project as product_memory, _thread as memory_thread
from .uony_conversation_queue import CANCELLED_MESSAGE, UNCONFIRMED_MESSAGE, ConversationQueue, failure_message
from .uony_written_failure import released_unknown_text
from .uony_engine import enabled_engines, selected_engine
from .uony_return_brief import routes as return_brief_routes
from .uony_assignments import focus_snapshot, routes as assignment_routes
from .uony_structured_focus_guard import check_target, claim_link
from .uony_assignment_materials import routes as assignment_material_routes
from .product_proposals import routes as product_proposal_routes
from .uony_live_bridge import pilot_budget_available
from .creative_planning import latest as latest_creative_plan
from .creative_model_selection import submit_if_answer as submit_creative_model_choice
from . import uony_followup_store
from .uony_followups import routes as followup_routes
from .uony_admission_budget import admission_budget

class ExpectedAssignmentFocus(StrictBody):
    assignmentId: UUID | None = Field(default=None, strict=False)
    version: int = Field(ge=0)

    @model_validator(mode='after')
    def valid_pair(self):
        if (self.assignmentId is None) != (self.version == 0):
            raise ValueError('El foco esperado necesita un ID y versión compatibles.')
        return self

class Message(StrictBody):
    productContext: ProductContext | None = None
    productAction: ProductAction | None = None
    formResponse: FormResponse | None = None
    incidentAction: IncidentAction | None = None
    materialAction: MaterialAction | None = None
    requirementsAction: RequirementsAction | None = None
    expectedAssignmentFocus: ExpectedAssignmentFocus | None = None
    requestId: UUID = Field(strict=False)
    retryOf: UUID | None = Field(default=None,strict=False)
    threadId: str = Field(min_length=1,max_length=80,pattern=r'^[A-Za-z0-9_-]+$')
    text: str = Field(min_length=1,max_length=3000)
    projectId: UUID | None = Field(default=None,strict=False)
    model: Model = 'auto'
    effort: Effort = 'medium'


def require_expected_focus(connection, user, body):
    actual = focus_snapshot(connection, user, body.threadId)
    expected = body.expectedAssignmentFocus
    if actual[0] is not None and expected is None:
        raise HTTPException(409, detail={'error':'assignment_focus_required',
            'message':'Actualiza el encargo seleccionado antes de enviar este mensaje.'})
    if expected is not None and actual != (expected.assignmentId, expected.version):
        raise HTTPException(409, detail={'error':'assignment_focus_conflict',
            'message':'El encargo seleccionado cambió. Revisa cuál quieres continuar.'})
    return actual[0]


def services(connection,user):
    amazon=connection.execute('SELECT seller_id FROM amazon_connections WHERE user_id=%s',(user['id'],)).fetchone()
    cloud=connection.execute('SELECT status,email,google_subject,project_id,project_check FROM google_cloud_connections WHERE user_id=%s',(user['id'],)).fetchone()
    drive=connection.execute('SELECT status,email,google_subject FROM google_drive_connections WHERE user_id=%s',(user['id'],)).fetchone()
    if cloud and not connection_matches(user, cloud):
        cloud={'status':'disconnected','email':None,'project_id':None,'project_check':None}
    if drive and not connection_matches(user, drive):
        drive={'status':'disconnected','email':None}
    return {'accountEmail':user['email'], 'googleCloudEmail':cloud['email'] if cloud and cloud['status']!='disconnected' else None,
            'driveEmail':drive['email'] if drive and drive['status']!='disconnected' else None, 'googleCloud':cloud['status'] if cloud else 'disconnected', 'projectId':cloud['project_id'] if cloud else None,
            'projectReady':bool(cloud and cloud['status']=='connected' and (cloud['project_check'] or {}).get('ready')), 'drive':drive['status'] if drive else 'disconnected',
            'uonyText':'integrated', 'model':MODEL, 'location':LOCATION,
            'products':'integrated','driveAgent':'analysis_integrated','image':'not_integrated','video':'not_integrated','liveVoice':'not_integrated','amazon':'incidents_integrated',
            'amazonIncidents':'integrated','amazonPublication':'not_integrated',
            'amazonConnection':'connected' if amazon else 'disconnected','amazonSellerId':amazon['seller_id'] if amazon else None,
            'blenderLocal':blender_status(connection,user,include_usage=False)}


def routes(settings,database,cloud,provider,incidents=None,requirements=None,materials=None,live=None):
    router=APIRouter(prefix='/api/uony'); queue=ConversationQueue(database,enabled_engines(settings),
        getattr(settings, 'conversation_active_limit', 256))
    router.include_router(context_routes(settings,database,cloud,provider,incidents,materials))
    router.include_router(google_billing_routes(settings,database,cloud))
    router.include_router(return_brief_routes(settings,database))
    router.include_router(assignment_routes(settings,database))
    if materials is not None:
        router.include_router(assignment_material_routes(settings,database,materials))
    router.include_router(product_proposal_routes(settings,database))
    router.include_router(followup_routes(settings,database,cloud,queue,Message,require_expected_focus))

    @router.get('/catalog')
    def public_catalog():
        efforts=[dict(e) for e in EFFORTS if e['id'] in get_args(Effort)]
        return {'models':[{**m,'efforts':[e['id'] for e in efforts]} for m in MODELS],
                'efforts':efforts,'preferences':Preferences().model_dump(),'autoPolicy':POLICY,
                'scope':'platform','requiresAccountVerification':True}

    @router.get('/options')
    def model_options(request:Request):
        with database.connect() as connection:
            return options(connection,require_user(connection,request))

    @router.put('/preferences')
    def preferences(body:Preferences,request:Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user=require_user(connection,request)
            resolve(body.model,body.effort,options(connection,user))
            connection.execute('INSERT INTO uony_preferences(user_id,model,effort) VALUES(%s,%s,%s) ON CONFLICT(user_id) DO UPDATE SET model=excluded.model,effort=excluded.effort,updated_at=now()', (user['id'],body.model,body.effort))
            return body.model_dump()

    @router.get('/services')
    def status(request:Request):
        with database.connect() as connection:
            user=require_user(connection,request)
            result=services(connection,user)
            result['access']=workspace_access(connection,user)
            cloud_scope = connection.execute('''SELECT scope FROM google_cloud_connections
                WHERE user_id=%s''', (user['id'],)).fetchone()
            if (live is not None and str(user['id']) in settings.live_pilot_user_ids
                    and user.get('onboarding_completed_at')
                    and result['projectReady']
                    and cloud_scope and SCOPE in (cloud_scope['scope'] or '').split()
                    and result['access']['status']=='allowed'):
                result['liveVoice']=('pilot_ready' if pilot_budget_available(
                    connection, user['id'], settings.live_pilot_session_limit)
                    else 'pilot_exhausted')
            verification=connection.execute("""SELECT created_at FROM uony_requests
                WHERE user_id=%s AND status='success' AND project_id=%s AND model=%s
                AND jsonb_typeof(usage->'calls')='number'
                AND (usage->>'calls') ~ '^[1-9][0-9]*$'
                ORDER BY created_at DESC LIMIT 1""",
                (user['id'],result['projectId'],MODEL)).fetchone()
            result['lastResponseAt']=verification['created_at'].isoformat() if verification else None
            return result

    @router.get('/threads')
    def threads(request:Request):
        with database.connect() as connection:
            user=require_user(connection,request)
            rows=connection.execute("""WITH latest AS (
                    SELECT r.request_id FROM uony_requests r
                    JOIN uony_threads t ON t.user_id=r.user_id AND t.id=r.thread_id
                    LEFT JOIN uony_conversation_jobs j ON j.user_id=r.user_id AND j.request_id=r.request_id
                    WHERE r.user_id=%s AND t.deleted_at IS NULL
                    AND (r.status='success' OR j.status IN ('error','unknown','cancelled'))
                    ORDER BY r.created_at DESC LIMIT 200
                )
                SELECT r.request_id,r.thread_id,r.prompt,r.reply,r.model,r.effort,r.created_at,
                r.selection_reason,r.product_changes,r.connection_actions,r.conversation_form,
                r.material_analysis,r.product_intake,r.product_proposal,j.status AS job_status,
                j.error_code AS job_error_code,j.provider_error_code AS job_provider_error_code,
                j.finished_at AS job_finished_at,j.engine AS job_engine,j.acknowledged_at AS job_acknowledged_at,
                h.turn_id AS source_live_turn_id
                FROM uony_requests r JOIN uony_threads t ON t.user_id=r.user_id AND t.id=r.thread_id
                LEFT JOIN uony_conversation_jobs j ON j.user_id=r.user_id AND j.request_id=r.request_id
                LEFT JOIN uony_live_handoffs h ON h.user_id=r.user_id AND h.request_id=r.request_id
                WHERE r.user_id=%s AND t.deleted_at IS NULL
                AND (r.status='success' OR j.status IN ('error','unknown','cancelled'))
                AND (r.request_id IN (SELECT request_id FROM latest)
                    OR (j.status='unknown' AND j.acknowledged_at IS NULL))
                ORDER BY r.created_at DESC""",(user['id'],user['id'])).fetchall()
            voice=connection.execute('''SELECT thread_id,role,text,turn_id,created_at,reply_to_turn_id
                FROM (SELECT v.thread_id,v.role,v.text,v.turn_id,v.created_at,
                    v.reply_to_turn_id,
                    row_number() OVER (ORDER BY v.created_at DESC,v.turn_id DESC) AS recent
                    FROM uony_live_turns v JOIN uony_threads t
                    ON t.user_id=v.user_id AND t.id=v.thread_id
                    WHERE v.user_id=%s AND t.deleted_at IS NULL
                    AND NOT (v.role='assistant' AND v.reply_to_turn_id IS NOT NULL
                        AND EXISTS (SELECT 1 FROM uony_live_handoffs h
                            WHERE h.user_id=v.user_id AND h.thread_id=v.thread_id
                              AND h.session_id=v.session_id
                              AND h.turn_id=v.reply_to_turn_id))) v
                WHERE recent<=200 ORDER BY created_at,turn_id''', (user['id'],)).fetchall()
            # C2 (REA re-x-ray / modelo B): OCULTA del sidebar del cliente los hilos Estudio dedicados
            # (prefijo reservado `estudio-clip:`) — son el ancla invisible del clip, no conversaciones.
            saved=connection.execute("SELECT id,title,project_id FROM uony_threads t WHERE user_id=%s AND deleted_at IS NULL AND id NOT LIKE %s ORDER BY GREATEST(COALESCE((SELECT max(created_at) FROM uony_requests r WHERE r.user_id=t.user_id AND r.thread_id=t.id AND r.status='success'),t.created_at),COALESCE((SELECT max(created_at) FROM uony_live_turns v WHERE v.user_id=t.user_id AND v.thread_id=t.id),t.created_at)),id",(user['id'],'estudio-clip:%')).fetchall()
            grouped={row['id']:{'id':row['id'],'title':row['title'],'projectId':str(row['project_id']) if row['project_id'] else None,'service':None,'view':'default','messages':[]} for row in saved}
            timeline={thread_id:[] for thread_id in grouped}
            for row in reversed(rows):
                thread=grouped.setdefault(row['thread_id'],{'id':row['thread_id'],'title':row['prompt'][:70],'service':None,'view':'default','messages':[]})
                messages=[]
                request_id=str(row['request_id'])
                user_message=({'role':'user','text':row['prompt'],'requestId':request_id}
                              if not row['source_live_turn_id'] else None)
                if row['job_status'] in ('error','unknown','cancelled'):
                    # Lote 6 (point 4): the bubble reads capa 2's own text (RETRY_LATER for a provider failure);
                    # lote 7 (P2): a released written unknown reads like a written failure, as inspect does.
                    released=released_unknown_text(row['job_status'],row['job_engine'],row['job_error_code'],
                        row['job_acknowledged_at'],row['source_live_turn_id'],row['job_provider_error_code'])
                    message=(released or UNCONFIRMED_MESSAGE if row['job_status']=='unknown' else
                             CANCELLED_MESSAGE if row['job_status']=='cancelled' else
                             failure_message(row['job_error_code'] or 'google_unavailable',row['job_provider_error_code']))
                    if user_message:
                        messages.append(user_message)
                    messages.append({'role':'assistant','text':message,'model':'uonify-guide',
                         'requestId':request_id,'requestStatus':row['job_status'],
                         **({'sourceLiveTurnId':str(row['source_live_turn_id'])}
                            if row['source_live_turn_id'] else {})})
                else:
                    if user_message:
                        messages.append(user_message)
                    messages.append({'role':'assistant','text':row['reply'],'model':row['model'],'effort':row['effort'],
                         'requestId':request_id,'productChanges':row['product_changes'],
                         'connectionActions':row['connection_actions'],'conversationForm':row['conversation_form'],
                         'materialAnalysis':row['material_analysis'],
                         **({'sourceLiveTurnId':str(row['source_live_turn_id'])}
                            if row['source_live_turn_id'] else {}),
                         **({'productProposal':row['product_proposal']} if row['product_proposal'] else {}),
                         **({'productIntake':row['product_intake']} if row['product_intake'] else {})})
                for order,message in enumerate(messages):
                    at = (row['job_finished_at'] or row['created_at']) if (
                        row['source_live_turn_id'] and message['role']=='assistant') else row['created_at']
                    timeline.setdefault(row['thread_id'],[]).append((at,order,message))
            for row in voice:
                timeline.setdefault(row['thread_id'],[]).append((row['created_at'],0,
                    {'role':row['role'],'text':row['text'],'model':'gemini-3.8-live',
                     'turnId':str(row['turn_id']),
                     **({'replyToTurnId':str(row['reply_to_turn_id'])}
                        if row['reply_to_turn_id'] else {})}))
            for thread_id,at,message in uony_followup_store.history(connection,user):
                timeline.setdefault(thread_id,[]).append((at,0,message))
            for thread_id,items in timeline.items():
                grouped[thread_id]['messages']=[message for _,_,message in
                    sorted(items,key=lambda item:(item[0],item[1]))]
            return {'threads':list(grouped.values())}

    @router.get('/threads/{thread_id}/product-memory')
    def thread_product_memory(thread_id:str,request:Request):
        with database.connect() as connection:
            user=require_user(connection,request)
            if not user.get('onboarding_completed_at') or workspace_access(connection,user)['status']!='allowed':
                raise HTTPException(403,detail={'error':'access_required','message':'Activa tu acceso a Uonify para consultar esta ficha.'})
            memory_thread(connection,user,thread_id)
            return {'productMemory':product_memory(connection,user,thread_id)}

    @router.get('/threads/{thread_id}/creative-plan')
    def creative_plan(thread_id:str,request:Request):
        with database.connect() as connection:
            user=require_user(connection,request)
            if not user.get('onboarding_completed_at') or workspace_access(connection,user)['status']!='allowed':
                raise HTTPException(403,detail={'error':'access_required',
                    'message':'Activa tu acceso a Uonify para consultar este plan.'})
            thread=connection.execute('''SELECT 1 FROM uony_threads WHERE user_id=%s
                AND id=%s AND deleted_at IS NULL''',(user['id'],thread_id)).fetchone()
            if not thread:
                raise HTTPException(404,detail={'error':'thread_not_found',
                    'message':'No se encuentra esta conversación.'})
            return {'creativePlan':latest_creative_plan(connection,user,thread_id)}

    @router.get('/requests/recent')
    def recent_requests(request:Request):
        with database.connect() as connection:
            user=require_user(connection,request)
            result=queue.recent(connection,user)
            uony_followup_store.annotate_recent(connection,user,result['requests'])
            result['requests'].extend(uony_followup_store.recent(connection,user,queue))
            return result

    @router.get('/requests/unresolved')
    def unresolved_requests(request:Request,after:UUID|None=None):
        with database.connect() as connection:
            return queue.unresolved(connection,require_user(connection,request),after)

    @router.get('/requests/{request_id}')
    def request_status(request_id:UUID,request:Request):
        with database.connect() as connection:
            user=require_user(connection,request)
            return (uony_followup_store.inspect(connection,user,request_id,queue)
                    or queue.inspect(connection,user,request_id))

    @router.get('/threads/{thread_id}/requests/{request_id}/receipt')
    def structured_request_receipt(thread_id:str,request_id:UUID,request:Request):
        """Read-only receipt for a lost response to a structured requirements action.

        A missing receipt does not prove a concurrent POST will not commit later;
        clients must keep the same request ID and body until they can reconcile it.
        """
        with database.connect() as connection:
            user=require_user(connection,request)
            row=connection.execute('''SELECT r.request_id,r.thread_id,r.status,r.requirements_action
                FROM uony_requests r JOIN uony_threads t
                  ON t.user_id=r.user_id AND t.id=r.thread_id
                WHERE r.user_id=%s AND r.thread_id=%s AND r.request_id=%s
                  AND r.requirements_action IS NOT NULL AND t.deleted_at IS NULL''',
                (user['id'],thread_id,request_id)).fetchone()
            if not row:
                raise HTTPException(404,detail={'error':'request_not_found',
                    'message':'No se encuentra esta revisión en tu conversación.'})
            action=row['requirements_action']
            keys=('action','sku','retry','acknowledgeUnknown','expectedRevision','expectedLinkVersion',
                  'expectedReasoningId','expectedReasoningStatus','expectedSourceFingerprint')
            return JSONResponse({'requestId':str(row['request_id']),'threadId':row['thread_id'],
                'status':row['status'],'action':{'kind':'requirements_prepare',
                    **{key:action.get(key) for key in keys}}},
                headers={'Cache-Control':'no-store'})

    @router.post('/requests/{request_id}/cancel')
    def cancel_request(request_id:UUID,request:Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            return queue.cancel(connection,require_user(connection,request),request_id)

    @router.post('/messages')
    def message(body:Message,request:Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user=require_user(connection,request)
            if not user.get('onboarding_completed_at') or workspace_access(connection,user)['status']!='allowed':
                raise HTTPException(403,detail={'error':'access_required','message':'Completa el alta y activa tu acceso a Uonify para hablar con Uony.'})
            validate_first_intent(connection,user,body)
            ensure_thread(connection,user,body)
            if connection.execute('''SELECT 1 FROM uony_written_followups
                WHERE user_id=%s AND request_id=%s''',(user['id'],body.requestId)).fetchone():
                raise HTTPException(409,detail={'error':'request_conflict',
                    'message':'Este identificador corresponde a una consulta de estado. Consulta su recibo antes de enviar otro mensaje.'})
            previous=connection.execute('SELECT * FROM uony_requests WHERE user_id=%s AND request_id=%s',(user['id'],body.requestId)).fetchone()
            if previous:
                durable=connection.execute('SELECT payload FROM uony_conversation_jobs WHERE user_id=%s AND request_id=%s',
                    (user['id'],body.requestId)).fetchone()
                if durable:
                    saved_payload={**durable['payload']}
                    saved_payload.setdefault('expectedAssignmentFocus',None)
                    if saved_payload!=body.model_dump(mode='json'):
                        raise HTTPException(409,detail={'error':'request_conflict','message':'Esta petición corresponde a otro mensaje.'})
                    state=queue.inspect(connection,user,body.requestId)
                    return JSONResponse(state,status_code=202 if state['status'] in ('queued','running') else 200)
                if previous.get('product_action') != (body.productAction.model_dump(mode='json') if body.productAction else None):
                    raise HTTPException(409,detail={'error':'request_conflict','message':'Esta petición corresponde a otra selección de producto.'})
                if previous.get('requirements_action') != (body.requirementsAction.model_dump(mode='json') if body.requirementsAction else None):
                    raise HTTPException(409,detail={'error':'request_conflict','message':'Esta petición corresponde a otra revisión.'})
                if body.retryOf and any(previous.get(key) for key in ('product_action',
                        'form_response','material_action','requirements_action','incident_action')):
                    raise HTTPException(409,detail={'error':'request_conflict',
                        'message':'Esta acción ya corresponde a una petición anterior.'})
                saved_focus=connection.execute('''SELECT thread_id,google_subject,assignment_id,
                    focus_version FROM uony_structured_focus_expectations
                    WHERE user_id=%s AND request_id=%s''',(user['id'],body.requestId)).fetchone()
                expected=body.expectedAssignmentFocus
                if (saved_focus is None)!=(expected is None) or saved_focus and (
                        saved_focus['thread_id']!=body.threadId or
                        saved_focus['google_subject']!=user['google_subject'] or
                        (saved_focus['assignment_id'],saved_focus['focus_version']) !=
                        (expected.assignmentId,expected.version)):
                    raise HTTPException(409,detail={'error':'request_conflict',
                        'message':'Esta petición corresponde a otro encargo seleccionado.'})
                if previous.get('material_action')!=(body.materialAction.model_dump(mode='json') if body.materialAction else None) or previous['prompt']!=body.text or previous['thread_id']!=body.threadId or previous['requested_model']!=body.model or previous['effort']!=body.effort or previous['product_context']!=(body.productContext.model_dump() if body.productContext else None) or previous['form_response']!=(body.formResponse.model_dump(mode='json') if body.formResponse else None) or previous.get('incident_action')!=(body.incidentAction.model_dump(mode='json') if body.incidentAction else None):
                    raise HTTPException(409,detail={'error':'request_conflict','message':'Esta petición corresponde a otro mensaje.'})
                if previous['status']=='success':return {'reply':previous['reply'],'model':previous['model'],'effort':previous['effort'],'selectionReason':previous['selection_reason'],'productChanges':previous['product_changes'],'connectionActions':previous['connection_actions'],'conversationForm':previous['conversation_form'],**({'materialAnalysis':previous['material_analysis']} if previous['material_analysis'] else {}),**({'productIntake':previous['product_intake']} if previous['product_intake'] else {}),**({'productProposal':previous['product_proposal']} if previous['product_proposal'] else {})}
                raise HTTPException(409,detail={'error':'already_attempted','message':'Este intento ya se ha iniciado. Consulta el historial y el estado actual antes de enviar uno nuevo.'})
            focus_id=require_expected_focus(connection,user,body)
            # La fila del usuario serializa la reserva incluso entre procesos del servidor.
            if connection.execute("""SELECT 1 FROM uony_conversation_jobs WHERE user_id=%s
                AND status IN ('queued','running')""",(user['id'],)).fetchone() or connection.execute(
                "SELECT 1 FROM uony_requests WHERE user_id=%s AND status='running' AND created_at>now()-interval '4 minutes'",
                (user['id'],)).fetchone():
                raise HTTPException(409,detail={'error':'busy','message':'Uony todavía está atendiendo tu petición anterior.'})
            if sum(bool(action) for action in (body.formResponse,body.incidentAction,body.materialAction,body.requirementsAction,body.productAction))>1:
                raise HTTPException(422,detail={'error':'invalid_action','message':'Envía una sola acción por mensaje.'})
            if body.retryOf and any((body.formResponse,body.incidentAction,body.materialAction,
                                    body.requirementsAction,body.productAction)):
                raise HTTPException(422,detail={'error':'invalid_retry','message':'Esta autorización corresponde solo a una respuesta de IA incierta.'})
            structured=any((body.formResponse,body.incidentAction,body.materialAction,
                            body.requirementsAction,body.productAction))
            claim_product=check_target(connection,user,body,focus_id) if structured else None
            if body.expectedAssignmentFocus is not None and structured:
                expected=body.expectedAssignmentFocus
                connection.execute('''INSERT INTO uony_structured_focus_expectations
                    (user_id,request_id,thread_id,google_subject,assignment_id,focus_version)
                    VALUES(%s,%s,%s,%s,%s,%s)''', (user['id'],body.requestId,body.threadId,
                    user['google_subject'],expected.assignmentId,expected.version))
            if body.productAction:
                result=execute_product_action(connection,user,body)
                claim_link(connection,user,focus_id,claim_product)
                return result
            model_choice=submit_creative_model_choice(connection,user,body)
            if model_choice:
                return model_choice
            if body.formResponse:
                form=material_form(connection,user,body)
                if form: return execute_material(materials,requirements,connection,user,body,form)
                if body.incidentAction: raise HTTPException(422,detail={'error':'invalid_action','message':'Envía una sola acción por mensaje.'})
                form=incident_form(connection,user,body)
                if form: return execute_incident(incidents,connection,user,body,form)
                return submit_guide(connection,user,body,body.formResponse,requirements=requirements)
            if body.materialAction:
                return execute_material(materials,requirements,connection,user,body)
            if body.requirementsAction:
                return execute_requirements(requirements,connection,user,body)
            if body.incidentAction:
                return execute_incident(incidents,connection,user,body)
            count=uony_followup_store.daily_count(connection,user)
            limit=admission_budget(settings,user,body.projectId)
            if count>=limit:raise HTTPException(429,detail={'error':'daily_limit','message':f'Has alcanzado el límite de {limit} peticiones diarias de esta integración.'})
            row,selected,reason=cloud_selection(connection,user,body.model,body.effort)
            if body.productContext and find(connection,user,body.productContext.sku)['revision']!=body.productContext.revision:
                raise HTTPException(409,detail={'error':'product_conflict','message':'La ficha cambió. Revisa su versión antes de enviar.'})
            queued=queue.enqueue(connection,user,body,row,selected,reason,
                                 product_memory(connection,user,body.threadId),
                                 selected_engine(settings,user['id']),
                                 allowed_engines=enabled_engines(settings,user['id']))
            return JSONResponse(queued,status_code=202)
    return router
