"""Execute one reserved conversation in the owning Google account."""
import logging
from uuid import UUID
from cryptography.fernet import Fernet
from fastapi import HTTPException
from psycopg.types.json import Jsonb
from .access import workspace_access
from .google_cloud_provider import CloudError
from .products import find
from .uony_context import cloud_selection, conversation_context
from .uony_assignments import _assignment, focus_snapshot
from .uony_projects import check_thread
from .product_memory import project as product_memory
from .uony_conversation_queue import ConversationQueue, LeaseLost, safe_usage
from .uony_engine import ADK, CLASSIC, EngineProviders, EngineUnavailable, enabled_engines, selected_engine, supports_streaming
from .uony_voice_truth import accurate_voice_reply, voice_status
from .uony_semantic_decision import restore_decision
from .uony_semantic_worker import resolve_request, validate_drive_result, _drive_token
from .uony_call_accounting import CallAccounting
from .uony_call_policy import CallPolicy, typed_reason
from .uony_live_provenance import voice_action_allowed
from .uony_drive_scope import attach_to_job, settle_turn
from .uony_read_intent import ReadIntentCheck, counted
from .uony_written_failure import written_failure
from .uony_drive_focus import focus_instruction
from .uony_erp_focus import attach_erp, erp_instruction, validate_erp_result
from .uony_live_text import ProvisionalText

logger = logging.getLogger(__name__)

# A failure of Uonify's own code or database is not a Google outage (AI-19): before this split
# every unexpected exception reached the customer as google_unavailable (ADK-FLUJOS, finding A6).
INTERNAL_ERRORS = (ImportError, NameError, AttributeError, TypeError, KeyError,
                   IndexError, AssertionError, NotImplementedError, RecursionError,
                   ZeroDivisionError)


def failure_code(error):
    """Code for an exception that no typed branch handled. Never inspects text."""
    if isinstance(error, INTERNAL_ERRORS) or type(error).__module__.startswith('psycopg'):
        return 'internal_error'
    return 'google_unavailable'

# These tools enqueue external work before the conversation commits. They need
# their own fenced checkpoint before being admitted to the durable worker.
UNFENCED_TOOLS = {'inspect_blender_scene','render_blender_preview',
                  'start_incident_resolution'}

# ADK runs tools after a separately checkpointed model call. Admit only tools
# audited to be local-state operations or in-memory preparations; product and
# conversation changes happen in finish() under the lease. New BusinessTools entries
# stay unavailable to ADK until their effects have been classified.
ADK_ALLOWED_TOOLS = frozenset({
    'ask_user', 'create_product', 'get_blender_status', 'get_product',
    'get_product_materials', 'link_product_to_thread', 'list_product_incidents',
    'list_products', 'remember_assignment', 'show_account_deletion', 'show_amazon_connection',
    'show_connection', 'show_product_intake', 'show_product_materials',
    'start_product_guide', 'update_product', 'prepare_creative_plan', 'get_creative_plan',
    'get_creative_preparation',
    'request_drive_scope', 'list_drive_folders', 'list_drive_files', 'get_drive_item',
    'count_drive_folders', 'read_drive_document',
    'get_finance_context', 'list_finance_documents', 'get_finance_document',  # ERP: GET, nunca en voz (C5).
})
# A Live function call is intent classification, never authorization. These
# tools can read saved state, prepare a question/selection card, or persist the
# customer's explicitly requested goal via remember_assignment. In particular
# create_product and all external/queued effects remain unavailable
# until the client uses the existing typed controls after reviewing the result.
LIVE_HANDOFF_ALLOWED_TOOLS = frozenset({
    'ask_user', 'get_connection_status', 'get_product', 'get_product_materials',
    'list_products', 'remember_assignment', 'show_connection',
    'show_product_intake', 'show_product_materials',
    'list_drive_folders', 'list_drive_files', 'get_drive_item',
    'count_drive_folders', 'read_drive_document',
})
CREATIVE_LIVE_HANDOFF_TOOLS = frozenset({
    'prepare_creative_plan', 'get_creative_plan', 'get_creative_preparation',
})
CONFLICTING_PRODUCT_TOOLS = frozenset({
    'create_product', 'update_product', 'link_product_to_thread',
    'show_product_intake', 'show_product_materials', 'get_product_materials',
    'start_product_guide', 'prepare_creative_plan',
})
# Uony's written agent (the brain the client feels): Gemini 3.5 Flash GA, owner
# decision of 21-10-2026, literal «Pasar a Gemini 3.5 Flash (Recomendado)»
# («Consultor google»: MEDIUM, global). B2 n.º 3: 98 % of decisions, no 429 and
# a 2.9 s p50 call, against the preview Pro that lost 30 % of its turns to
# capacity (and 4 of 13 orders in the real pass C). The fast interpreter stays
# pinned separately.
AGENT_MODEL = 'gemini-3.5-flash'
# MEDIUM (owner-chosen with Pro): HIGH took ~20s (4 reasoning rounds) and the live
# voice dropped before it could speak the answer; MEDIUM replies fast enough.
AGENT_EFFORT = 'medium'
# Spoken requests use a fast, stable agent: Gemini 3.5 Flash, owner decision of
# 20-10-2026 (Pro preview measured 9-10 s per turn and a 504 after 58 s).
VOICE_AGENT_MODEL = 'gemini-3.5-flash'


def agent_model_for(handoff):
    return VOICE_AGENT_MODEL if handoff else AGENT_MODEL


class ConversationWorker:
    def __init__(self, settings, database, cloud, provider, incidents=None,
                 requirements=None, materials=None, *, semantic_classifier=None):
        self.semantic_classifier=semantic_classifier
        self.settings=settings
        self.database=database
        self.cloud=cloud
        self.providers=(provider if isinstance(provider,EngineProviders) else
                        EngineProviders(settings,{selected_engine(settings):provider}))
        self.incidents=incidents
        self.requirements=requirements
        self.materials=materials
        enabled=enabled_engines(settings)
        # A worker with no ADK pilot account still needs to terminate older
        # queued ADK requests after rollback. The creation cutoff prevents a
        # stale worker from claiming newly admitted pilot jobs during rollout.
        # Use PostgreSQL's clock, since created_at also comes from PostgreSQL.
        drain_before=None
        if ADK not in enabled:
            with database.connect() as c:
                drain_before=c.execute('SELECT clock_timestamp() AS at').fetchone()['at']
        self.queue=ConversationQueue(database,(CLASSIC,ADK),
            disabled_adk_before=drain_before)
        self.cipher=Fernet(settings.encryption_key)
        self.streaming_enabled=settings.streaming_enabled
        self.streaming=supports_streaming(self.providers.selected_engine,
            self.providers.get(self.providers.selected_engine),self.streaming_enabled)

    def validate(self, c, job, body, *, lock=True):
        from .uony_routes import services
        query='SELECT * FROM users WHERE id=%s' + (' FOR UPDATE' if lock else '')
        user=c.execute(query,(job['user_id'],)).fetchone()
        if not user or user.get('deletion_requested_at') or user['google_subject']!=job['google_subject']:
            raise CloudError('reauthorize')
        self.queue.assert_lease(c,job)
        if not user.get('onboarding_completed_at') or workspace_access(c,user)['status']!='allowed':
            raise HTTPException(403,detail={'error':'access_required',
                'message':'Tu acceso ya no está activo. Conservamos la petición sin ejecutar otra llamada.'})
        if not check_thread(c,user,body):
            raise HTTPException(404,detail={'error':'thread_not_found',
                'message':'La conversación ya no está disponible.'})
        cloud,selected,_=cloud_selection(c,user,body.model,body.effort)
        if cloud['project_id']!=job['project_id'] or cloud['google_subject']!=job['google_subject']:
            raise HTTPException(409,detail={'error':'google_changed',
                'message':'La conexión de Google cambió. Esta petición no se enviará con otra cuenta o proyecto.'})
        saved=c.execute('SELECT model FROM uony_requests WHERE user_id=%s AND request_id=%s',
                        (job['user_id'],job['request_id'])).fetchone()
        if not saved or selected!=saved['model']:
            raise HTTPException(409,detail={'error':'model_changed',
                'message':'El modelo verificado cambió antes de ejecutar esta petición.'})
        if body.productContext:
            actual=find(c,user,body.productContext.sku)
            if actual['revision']!=body.productContext.revision:
                raise HTTPException(409,detail={'error':'product_conflict',
                    'message':'La ficha cambió antes de enviar esta petición. Revisa su versión actual.'})
        if product_memory(c,user,body.threadId)!=job['memory_snapshot']:
            raise HTTPException(409,detail={'error':'product_memory_conflict',
                'message':'La ficha vinculada cambió antes de responder. Consulta su estado actual.'})
        if job.get('assignment_focus_pinned') and focus_snapshot(c,user,body.threadId)!=(
                job['assignment_focus_id'],job['assignment_focus_version']):
            raise HTTPException(409,detail={'error':'assignment_focus_conflict',
                'message':'El encargo seleccionado cambió. Revisa cuál quieres continuar.'})
        status=services(c,user)
        status['liveVoice']=voice_status(c,user,cloud,self.settings,status)
        return user,cloud,selected,status

    def fail(self, job, code, usage=None, uncertain=False, uncertain_if_started=False, reason=None, tools_run=None):
        with self.database.connect() as c:
            c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(job['user_id'],)).fetchone()
            row=self.queue.assert_lease(c,job)
            # Hallazgo B: only a call left unresolved is unknown (a retried 429 consumed nothing).
            usage,logged=self.queue.settled_usage(c,job,usage,row)
            uncertain=(uncertain or code == 'execution_unknown' or
                (logged['unresolved']>0 if logged else
                 row['engine']==ADK and row['provider_started_at'] is not None and
                 row['provider_attempt_count']>row['provider_completed_count']) or
                (uncertain_if_started and row['provider_started_at'] is not None))
            written=uncertain and code!='execution_unknown' and written_failure(c,job,row['engine'],tools_run,reason)
            if written:uncertain,reason=False,written  # Lote 6 (point 5): no written ADK failure is a dead end.
            # Capa 2: the real cause (lote 6: typed) stays in the job and the log, never in the text.
            provider_code=(code if uncertain else reason) if code in ('reauthorize','permission_denied') else typed_reason(reason)
            logger.warning('Uony provider failure request_id=%s code=%s status=%s reason=%s',
                           job['request_id'],code,'unknown' if uncertain else 'error',reason)
            self.queue.terminal(c,job,'unknown' if uncertain else 'error',
                'consumption_unknown' if uncertain else code,usage,provider_code=provider_code)

    def run(self, job):
        from .uony_routes import Message
        body=Message.model_validate(job['payload'])
        usage=None
        provider_started=False
        direct_reply=None
        accounting=CallAccounting(self,job)
        ledger=context=None
        try:
            with self.queue.keeping_lease(job):
                if job['engine']==ADK and not self.providers.adk_enabled_for(job['user_id']):
                    raise EngineUnavailable('El piloto ADK ya no está habilitado para esta cuenta.')
                with self.database.connect() as c:
                    # Read-only context phase: do not hold users FOR UPDATE here.
                    # It is re-taken in the second validate (below) just before
                    # execution. Holding it across context building starves the
                    # Live narration's own users FOR UPDATE (200ms lock_timeout).
                    user,cloud,selected,status=self.validate(c,job,body,lock=False)
                    history,context,_=conversation_context(c,user,body,self.database,status,
                        self.incidents,self.materials,assignment_focus=(
                            (job['assignment_focus_id'],job['assignment_focus_version'])
                            if job.get('assignment_focus_pinned') else None))
                    # Drive reads only inside this request's server-emitted scope (F0.1); the
                    # token goes through _drive_token (fingerprint, mid-turn reconnect check).
                    if status.get('drive')=='connected' and getattr(context,'drive_read',None):
                        attach_to_job(self,user,job,body,context,lambda: _drive_token(self,user,job,body,context))
                    handoff=c.execute('''SELECT h.intent,h.google_subject,h.google_project_id,
                        h.thread_id,h.session_id,h.semantic_decision,h.drive_operation,v.finalized_by
                        FROM uony_live_handoffs h JOIN uony_live_turns v
                          ON v.user_id=h.user_id AND v.thread_id=h.thread_id
                          AND v.session_id=h.session_id AND v.turn_id=h.turn_id AND v.role='user'
                        WHERE h.user_id=%s AND h.request_id=%s''',
                        (user['id'],job['request_id'])).fetchone()
                    if handoff:
                        if (handoff['google_subject']!=user['google_subject'] or
                                handoff['google_project_id']!=cloud['project_id'] or
                                handoff['thread_id']!=body.threadId):
                            raise HTTPException(409,detail={'error':'google_changed',
                                'message':'La conexión del encargo hablado cambió.'})
                        context['liveHandoffIntent']=handoff['intent']
                        context.spoken_forms(body.text)  # Voice keeps its form opt-in until F1.
                    else:  # C5: la credencial del ERP, solo en encargos escritos de este worker.
                        attach_erp(self,user,job,body,context)
                    # A written Drive order reaches the agent, which asks the server
                    # for its scope (request_drive_scope); no regex answers it and
                    # no second click is required («Consultor google», F0).
                    selected_folder=(context.get('productIntake') or {}).get('folder')
                    semantic=(restore_decision(handoff['semantic_decision'],body.text,
                        selected_folder=selected_folder) if handoff and
                        handoff.get('semantic_decision') is not None else None)
                    # QA-03 («Consultor google», 21-10-2026): no written order is
                    # classified any more. Every one reaches the agent, with
                    # request_drive_scope and F0, and no server shortcut answers
                    # it. A written job interpreted before this change is not
                    # resumed half way.
                    if not handoff and job.get('semantic_decision'):
                        raise CloudError('invalid_response')
                    if handoff and handoff['intent']=='semantic_request' and semantic is None:
                        raise CloudError('invalid_response')
                    # One provenance list for every path (audit F0.2): no local copy.
                    if semantic and handoff and not voice_action_allowed(semantic.action,handoff['finalized_by']):
                        raise CloudError('invalid_response')
                with self.database.connect() as c:
                    user,cloud,selected,status=self.validate(c,job,body)
                if semantic is not None:  # A spoken interpreter decision, until F1-7a.
                    from .uony_semantic_recovery import resolve as resolve_recovery
                    body,semantic,direct_reply=resolve_recovery(self,user,job,body,cloud,
                        selected,semantic,accounting)
                    usage=accounting.usage or usage
                if direct_reply is None:
                    direct_reply=resolve_request(self,user,job,body,context,status,
                        selected_folder,semantic,handoff)
                if direct_reply is not None:
                    if direct_reply and body.text != job['payload']['text']:
                        direct_reply = 'He recuperado la petición anterior. ' + direct_reply
                    if accounting.offset:self.queue.provider_return(job)
                    self.finish(job,body,context,direct_reply,usage or {})
                    return
                provider=self.providers.get(job['engine'])
                token=self.cloud.refresh(self.cipher.decrypt(cloud['refresh_encrypted'].encode()).decode())
                # Every tool checks the same lease and current identity again.
                original=context.call
                product_conflict=bool((context.get('assignmentFocus') or {}).get('productConflict'))
                focused_product=(context.get('assignmentFocus') or {}).get('product') or {}
                def admitted(name):
                    if semantic and semantic.action=='conversation':return False
                    return (not (product_conflict and name in CONFLICTING_PRODUCT_TOOLS) and
                            (not handoff or name in LIVE_HANDOFF_ALLOWED_TOOLS or
                             (context.get('liveHandoffIntent')=='creative_plan' and
                              name in CREATIVE_LIVE_HANDOFF_TOOLS)) and
                            (name in ADK_ALLOWED_TOOLS if job['engine']==ADK else
                             name not in UNFENCED_TOOLS))
                context.declarations=[item for item in context.declarations
                                      if admitted(item['name'])]
                def guarded(name,args):
                    if product_conflict and name in CONFLICTING_PRODUCT_TOOLS:
                        return {'error':'assignment_product_conflict',
                            'message':'El encargo seleccionado corresponde a otra ficha. Aclara cuál quieres continuar antes de preparar cambios.'}
                    if product_conflict and name=='get_product' and (
                            not isinstance(args,dict) or args.get('sku')!=focused_product.get('sku')):
                        return {'error':'assignment_product_conflict',
                            'message':'Esta ficha no corresponde al encargo seleccionado.'}
                    if not admitted(name):
                        return {'error':'tool_requires_fenced_work',
                            'message':('Esta petición hablada solo puede preparar el siguiente paso; '
                                'la acción necesita su control y autorización propios.' if handoff else
                                'Esta operación aún no puede ejecutarse en segundo plano.')}
                    with self.database.connect() as c:
                        self.validate(c,job,body)
                    return original(name,args)
                context.call=guarded
                policy=CallPolicy.written(AGENT_EFFORT) if job['engine']==ADK and not handoff else None
                if getattr(self.settings,'read_intent_check',False) and not handoff:  # Plan B: one clock with the agent's.
                    context.read_intent=ReadIntentCheck(token,cloud['project_id'],job['request_id'],deadline=policy and policy.deadline)
                if job['engine']==ADK:
                    def reserve(ordinal):
                        nonlocal provider_started
                        accounting.reserve(ordinal)
                        provider_started=True
                    def started():
                        nonlocal provider_started
                        provider_started=True
                    # Hallazgo B: written orders retry transient errors within 60 s (policy above), each attempt logged first.
                    ledger=policy and accounting.ledger(agent_model_for(handoff),policy,started)
                    live=ProvisionalText(self.queue,job) if policy else None  # F1-S (lote 8): written turns.
                    reply,usage=provider.generate(token,cloud['project_id'],history,context,
                        model=agent_model_for(handoff),effort=AGENT_EFFORT,
                        on_attempt=reserve,on_complete=accounting.complete,
                        policy=policy,ledger=ledger,
                        instruction=erp_instruction(context,focus_instruction(context.get('driveFocus'))),
                        **({'on_text':live.text,'on_clear':live.clear} if live else {}))
                    usage=accounting.total(usage)
                elif supports_streaming(job['engine'],provider,self.streaming_enabled):
                    def reserve(ordinal):
                        nonlocal provider_started
                        self.queue.stream_attempt(job,ordinal)
                        provider_started=True
                    live=ProvisionalText(self.queue,job)  # Never an unchecked voice claim (lote 8: shared).
                    reply,usage=provider.generate(token,cloud['project_id'],history,context,
                        model=selected,effort=body.effort,streaming=True,
                        on_text=live.text,on_clear=live.clear,
                        on_attempt=reserve,
                        on_complete=lambda ordinal,reported:self.queue.stream_complete(job,ordinal,reported))
                else:
                    self.queue.provider_start(job)
                    provider_started=True
                    reply,usage=provider.generate(token,cloud['project_id'],history,context,
                        model=selected,effort=body.effort)
                self.queue.provider_return(job)
                self.finish(job,body,context,reply,usage,
                    agent_model=agent_model_for(handoff) if job['engine']==ADK else None,
                    agent_effort=AGENT_EFFORT if job['engine']==ADK else None)
        except LeaseLost:
            return
        except EngineUnavailable:
            try:self.fail(job,'engine_unavailable')
            except LeaseLost:return
        except CloudError as exc:
            reported=(getattr(exc,'usage',None) if getattr(exc,'semantic_usage_total',False)
                      else accounting.total(getattr(exc,'usage',None)))
            # The attempt log decides a written order (hallazgo B); its usage
            # counts a retried 503 that completed, which is not unknown.
            if_started=not ledger and (not reported or reported.get('uncertainCalls',0)>0)
            uncertain=provider_started and if_started
            effective_usage={**(reported or usage or (
                {'attemptedCalls':1,'uncertainCalls':1} if uncertain else {})),**counted(context)}
            try:self.fail(job,exc.code,effective_usage,uncertain,uncertain_if_started=if_started,
                          reason=getattr(exc,'reason',None),tools_run=getattr(context,'tools_run',0) if context else None)
            except LeaseLost:return
        except HTTPException as exc:
            code=exc.detail.get('error','conversation_conflict') if isinstance(exc.detail,dict) else 'conversation_conflict'
            try:self.fail(job,code,usage or ({'attemptedCalls':1,'uncertainCalls':1} if provider_started else {}),
                          provider_started and usage is None,uncertain_if_started=usage is None)
            except LeaseLost:return
        except Exception as error:
            # Never log provider text, credentials or user content: only the
            # exception class and the request correlation.
            usage=accounting.usage or usage
            code=failure_code(error)
            logger.warning('Uony worker failure request=%s code=%s class=%s provider_started=%s',
                           job['request_id'],code,type(error).__name__,provider_started)
            try:self.fail(job,code,usage or
                          ({'attemptedCalls':1,'uncertainCalls':1} if provider_started else {}),
                          provider_started,uncertain_if_started=True)
            except LeaseLost:return

    def finish(self, job, body, context, reply, usage, agent_model=None, agent_effort=None):
        from .product_guide import finalise_tools, introduction
        from .product_proposals import prepare as prepare_product_proposal
        usage={**(usage or {}),**counted(context)}  # Plan B's calls, in the job's usage.
        with self.database.connect() as c:
            user,_,_,status=self.validate(c,job,body)
            # Only a turn actually answered by the conversational agent is relabeled
            # to the capable model it ran on. Fixed-instruction Drive turns and
            # recovery/direct replies keep the model resolved at enqueue, because the
            # agent never generated for them.
            if agent_model:
                reason=('El agente de Uony respondió por voz con el modelo rápido.' if agent_model==VOICE_AGENT_MODEL
                        else 'El agente de Uony respondió con el modelo más capaz.')
                c.execute('''UPDATE uony_requests SET model=%s,effort=%s,selection_reason=%s
                    WHERE user_id=%s AND request_id=%s''',(agent_model,agent_effort,reason,user['id'],job['request_id']))
            validate_drive_result(self,c,user,job,context)
            validate_erp_result(c,user,context)  # C4: la huella del ERP del turno, como la de Drive.
            if context.assignment_action_conflict:
                raise HTTPException(409,detail={'error':'assignment_action_conflict',
                    'message':'Uony ha mezclado un encargo nuevo con otra acción. No se ha aplicado ningún cambio; vuelve a indicar cuál quieres iniciar.'})
            if context.get('productMemory') and product_memory(c,user,body.threadId)!=context['productMemory']:
                raise HTTPException(409,detail={'error':'product_memory_conflict',
                    'message':'La ficha cambió mientras Uony respondía. Consulta su estado actual.'})
            assignment_result=context.assignment.commit(c,user)
            creative_plan=context.creative.commit(c,user)
            # A model-produced create/update is only a proposal. A separate
            # owner-bound typed decision may apply it after customer review.
            proposal=prepare_product_proposal(c,user,body.threadId,body.requestId,context.pending)
            changes=[]
            product_intake=context.intake.commit(c,user)
            if product_intake and context.get('assignmentFocus'):
                assignment=_assignment(c,user,UUID(context['assignmentFocus']['id']))
                intake_id=UUID(product_intake['id'])
                if assignment['intake_id'] and assignment['intake_id']!=intake_id:
                    raise HTTPException(409,detail={'error':'assignment_product_conflict',
                        'message':'La selección de materiales corresponde a otro encargo.'})
                if not assignment['intake_id']:
                    c.execute('''UPDATE uony_assignments SET intake_id=%s,version=version+1,
                        updated_at=now() WHERE user_id=%s AND id=%s AND google_subject=%s
                        AND intake_id IS NULL''', (intake_id,user['id'],assignment['id'],
                                                user['google_subject']))
            product_link=context.product_link.commit(c,user)
            actions=context.connection_actions.present()
            material_analysis=None
            if context.materials.sku:
                product=find(c,user,context.materials.sku)
                material_analysis={'sku':product['sku'],'revision':product['revision']}
            form=None if assignment_result or proposal or material_analysis or product_intake or product_link else finalise_tools(
                context,c,user,changes,body.requestId,requirements=self.requirements)
            if form:reply=introduction(form)
            elif proposal:
                verb='crear' if proposal['action']=='create' else 'editar'
                reply=f"He preparado una propuesta para {verb} {proposal['targetSku']}. La ficha sigue sin cambios; revísala y confirma la acción para guardarla."
            elif context.guide_sku and self.requirements is not None:
                evaluation=self.requirements.get_for(c,user,context.guide_sku)['evaluation']
                reply=('Los datos necesarios están completos según los requisitos consultados. La ficha está guardada.'
                    if evaluation['state']=='locally_valid' else
                    'La ficha está guardada. Hay requisitos de Amazon que todavía necesitan comprobarse; tus datos se conservan.')
            elif not material_analysis and not product_intake:
                form=context.conversation_forms.present()
            if product_intake:reply='Elige la carpeta con los materiales de tu producto. Primero identificaremos la carpeta y te propondremos un nombre; el análisis solo empieza cuando tú lo indiques.'
            if product_link:reply=f"Continuaremos con {product_link['name']}. Consultaré los datos guardados de esta ficha sin volver a pedir los ya confirmados."
            if material_analysis:reply='Elige la carpeta de Drive que contiene los recursos de este producto. Al pulsar Analizar, Uony utilizará los datos de tus archivos para preparar la ficha y te preguntará solo lo que falte para Amazon.'
            if context.incidents.result:reply,form=context.incidents.result
            if assignment_result:
                if assignment_result.get('ambiguous'):
                    reply='¿Quieres continuar el encargo que ya tienes guardado o iniciar otro producto distinto?'
                elif assignment_result['created']:
                    source=context.assignment.prepared['startingPoint']
                    next_question={
                        'unknown':'¿Tienes fotos o documentos del producto, o partimos de cero?',
                        'materials':'Podemos elegir la carpeta de Drive cuando quieras. ¿La tienes preparada?',
                        'from_scratch':'¿Qué producto vamos a preparar?',
                    }[source]
                    reply=f"He guardado el encargo «{assignment_result['label']}». {next_question}"
                else:
                    reply=f"Ese encargo ya estaba guardado como «{assignment_result['label']}». Continuamos con él."
            if context.assignment.rejected:
                reply='¿Quieres que guardemos ahora un encargo nuevo para preparar un producto en Amazon?'
            if creative_plan:
                from .creative_planning import response as creative_response, model_choice_form
                choice_form=model_choice_form(creative_plan) if not form else None
                if choice_form:
                    result=context.conversation_forms.ask(choice_form)
                    if result.get('prepared'):
                        form=context.conversation_forms.present()
                reply=creative_response(creative_plan,
                                        model_question_visible=not bool(choice_form and form))
            if context.creative_preparation_requested:
                from .creative_preparation_reply import preparation_reply
                from .creative_preparation_service import get_creative_preparation
                # This owner transaction holds the live job lease. Re-read even
                # when the model read earlier; a same-turn plan now exists here.
                preparation=get_creative_preparation(c,user,body.threadId)
                if creative_plan and (not preparation or preparation['planId']!=creative_plan['id']):
                    raise HTTPException(409,detail={'error':'creative_plan_conflict',
                        'message':'El plan creativo cambió antes de responder. Consulta su estado actual.'})
                summary=preparation_reply(preparation,ask_next=not bool(form))
                has_effect=bool(creative_plan or assignment_result or proposal or product_intake or
                    product_link or material_analysis or context.guide_sku or context.incidents.result or form)
                reply=f'{reply}\n\n{summary}' if has_effect else summary
            if self.requirements is not None and form and form.get('context',{}).get('kind')=='product_guide' and form['context'].get('step')=='reasoning':
                followup=self.requirements.get_for(c,user,form['context']['sku'])['evaluation'].get('connectionActions',[])
                actions=list({action['provider']:action for action in actions+followup}.values())
            drive=getattr(context,'drive_read',None)
            reply=accurate_voice_reply(reply,status['liveVoice'])
            c.execute("""UPDATE uony_requests SET status='success',reply=%s,usage=%s,
                product_changes=%s,connection_actions=%s,conversation_form=%s,
                material_analysis=%s,product_intake=%s,product_proposal=%s
                WHERE user_id=%s AND request_id=%s""",
                (reply,Jsonb(safe_usage(usage)),Jsonb(changes),Jsonb(actions),Jsonb(form) if form else None,
                 Jsonb(material_analysis) if material_analysis else None,
                 Jsonb(product_intake) if product_intake else None,
                 Jsonb(proposal) if proposal else None,job['user_id'],job['request_id']))
            settle_turn(c,user['id'],job['request_id'],drive,reply)  # Lote 5: the offer, if the reply names it.
            # Lote 8, 1b: closed with its card after a failed last call; that call stays uncertain.
            card_failure=getattr(context,'closed_with_card',None)
            if card_failure:usage,_=self.queue.settled_usage(c,job,usage)
            self.queue.terminal(c,job,'success',usage=usage,
                provider_code=card_failure and typed_reason(f'closed_with_card:{card_failure}'[:40]))
