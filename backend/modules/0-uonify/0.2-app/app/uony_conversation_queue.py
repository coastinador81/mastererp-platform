"""PostgreSQL leases for conversation generation; never replay a started call."""
from uuid import uuid4
from fastapi import HTTPException
from psycopg.errors import LockNotAvailable
from psycopg.types.json import Jsonb
from .uony_assignments import focus_snapshot
from .uony_assignment_tool import created_focus
from .uony_engine import CLASSIC, ENGINES

from .uony_queue_state import LeaseLost, safe_usage, merge_usage, RecoveryPolicy
from .uony_queue_lifecycle import PARKED_UNTIL, QueueLifecycle
from .uony_queue_attempts import ProviderAttempts
from .uony_semantic_failure import saved_semantic_failure

CAPACITY_MESSAGE='Uony está atendiendo muchas peticiones. No hemos enviado tu mensaje. Vuelve a intentarlo en unos instantes.'
# Capa 2 («Consultor google», 21-10-2026; fixed texts in the owner's approval
# list): what the customer reads when a request ends without an answer. Never
# the provider, its quotas or capacity, nor a code; a cause the customer can
# fix names its concrete step and shows this conversation's connection card.
RETRY_LATER='No he podido terminar esto ahora mismo. ¿Lo intento de nuevo?'
UNCONFIRMED_MESSAGE=('No he podido confirmar si esta petición llegó a completarse. No la repetiré '
    'por mi cuenta; revisa el historial antes de pedirla otra vez.')
CANCELLED_MESSAGE='Esta petición se canceló antes de empezar.'
AGENT_LIMIT_MESSAGES={
    'tool_limit':'No he podido terminar en los pasos disponibles. ¿Lo intento por partes?',
    'deadline_exceeded':RETRY_LATER}
FAILURE_MESSAGES={'restore_reconciliation_required':'Esta petición procede de una copia restaurada. Conservamos el encargo, pero debemos verificar si ya se ejecutó antes de volver a intentarlo.',
    'consumption_unknown':UNCONFIRMED_MESSAGE,
    'cancelled':CANCELLED_MESSAGE,
    'reauthorize':'Para seguir, vuelve a autorizar la conexión de tu proyecto desde la tarjeta de esta conversación.',
    'permission_denied':'Para seguir, revisa los permisos y la facturación de tu proyecto desde la tarjeta de esta conversación.',
    'drive_reconnect':'Para seguir, vuelve a conectar tu Drive desde la tarjeta de esta conversación.',
    'google_required':'Conecta tu cuenta y proyecto de Google para hablar con Uony.',
    'quota_exceeded':RETRY_LATER,
    'google_unavailable':RETRY_LATER,
    'access_required':'Tu acceso a Uonify cambió antes de completar esta petición.',
    'product_conflict':'La ficha cambió antes de completar esta petición. Revisa la versión actual.',
    'product_memory_conflict':'La ficha vinculada cambió antes de completar esta petición.',
    'assignment_focus_required':'Actualiza el encargo seleccionado antes de enviar este mensaje.',
    'assignment_focus_conflict':'El encargo seleccionado cambió. Revisa cuál quieres continuar; no se repetirá esta petición automáticamente.',
    'google_changed':'La cuenta o proyecto de Google cambió; esta petición no se envió con otra identidad.',
    'model_changed':'El modelo verificado cambió antes de ejecutar esta petición.',
    'engine_unavailable':'Esta petición no se ha enviado. Vuelve a intentarlo en un momento.',
    **AGENT_LIMIT_MESSAGES,
    'internal_error':'Uony tuvo un fallo interno y no terminó esta petición. Tu conversación se conserva y no se repetirá automáticamente.',
    'semantic_timeout':'La recuperación agotó su tiempo de interpretación. No he iniciado otra ejecución; el intento y su consumo se conservan.',
    # Drive refusals that are not a lost connection (audit F0.5).
    'rate_limited':'Tu Drive está limitando las consultas en este momento. Vuelve a pedírmelo en unos segundos.',
    'file_forbidden':'No tengo permiso para abrir ese archivo de Drive: su propietario o tu organización lo limitan.',
    'file_too_large':'El documento es demasiado grande para leerlo en línea.'}
# A refusal the customer can fix, by the reason the 401/403 gave (D8, mapped
# in google_setup_diagnostics): its own step instead of the general one.
FIXABLE_MESSAGES={
    'billing_required':'Para seguir, activa la facturación de tu proyecto. Te dejo aquí la tarjeta de conexión.',
    'service_disabled':'Para seguir, activa la API de IA en tu proyecto. Te dejo aquí la tarjeta de conexión.',
    'reauthorize':FAILURE_MESSAGES['reauthorize']}
UNCONFIRMED_ACCESS=' Revisa la conexión y los permisos de tu proyecto desde la tarjeta de esta conversación antes de pedir otro intento.'
UNCONFIRMED_RETRY='No he podido confirmar si tu petición anterior se completó. Para repetirla, confirma el reintento.'


def failure_message(code, provider_code=None):
    """The customer's text for a request that ended without an answer."""
    if code in ('reauthorize','permission_denied') and provider_code in FIXABLE_MESSAGES:
        return FIXABLE_MESSAGES[provider_code]  # D8: the step the refusal named.
    return FAILURE_MESSAGES.get(code, RETRY_LATER)


def failure_card(code, provider_code=None):
    """This conversation's connection card for a cause the customer can fix."""
    if code in ('reauthorize','permission_denied','google_required') or provider_code in ('reauthorize','permission_denied'):
        return [{'provider':'cloud','action':'manage'}]
    if code=='drive_reconnect':  # A lost Drive connection: Drive's card, not Cloud's.
        return [{'provider':'drive','action':'manage'}]
    return None


def error(code, message, status=409):
    return HTTPException(status, detail={'error': code, 'message': message})


class ConversationQueue(ProviderAttempts, QueueLifecycle):
    def __init__(self, database, engines=(CLASSIC,), active_limit=256,
                 *, disabled_adk_before=None, recovery_policy=None):
        if active_limit < 1:
            raise ValueError('active_limit must be positive')
        self.database = database
        self.recovery_policy = recovery_policy or RecoveryPolicy.from_environment()
        self.engines = tuple(engines)
        self.active_limit = active_limit
        # A worker started after the last pilot account was removed may drain
        # older, pinned ADK jobs without letting a stale worker take new jobs
        # admitted by an API process during a rolling configuration change.
        self.disabled_adk_before = disabled_adk_before

    def require_global_capacity(self, c):
        # Separate statements matter: READ COMMITTED must count *after* the
        # previous enqueuer commits. All API instances use the same DB lock.
        try:
            c.execute("SET LOCAL lock_timeout = '500ms'")
            c.execute('SELECT pg_advisory_xact_lock(71072027)')
        except LockNotAvailable:
            raise error('capacity_busy', CAPACITY_MESSAGE, 429) from None
        c.execute("SET LOCAL lock_timeout = '0'")
        active=c.execute("""SELECT count(*) AS n FROM (
            SELECT 1 FROM uony_conversation_jobs
            WHERE status IN ('queued','running')
            UNION ALL SELECT 1 FROM uony_written_followups
            WHERE state='started' AND deadline_at>now() LIMIT %s
        ) AS admitted""", (self.active_limit,)).fetchone()['n']
        if active >= self.active_limit:
            raise error('capacity_busy', CAPACITY_MESSAGE, 429)

    def enqueue(self, c, user, body, cloud, selected, reason, memory, engine,
                *, allowed_engines=None, parked=False):
        """parked (D8): an order written while the account's current work runs
        waits for it (available_at PARKED_UNTIL, released when that work ends);
        one at a time. Without current work it is an ordinary request."""
        allowed = tuple(allowed_engines if allowed_engines is not None else self.engines)
        if engine not in allowed:
            raise error('engine_unavailable',
                        'El motor de esta cuenta no está disponible. No se ha enviado la petición.')
        if body.retryOf and c.execute('''SELECT 1 FROM uony_semantic_requests
            WHERE user_id=%s AND (logical_request_id=%s OR business_request_id=%s)''',
            (user['id'], body.retryOf, body.retryOf)).fetchone():
            raise error('invalid_retry', 'Esta petición conserva su estado de interpretación y ejecución. '
                'Pídeme recuperar la petición anterior en la conversación para comprobarla sin duplicarla.')
        payload = body.model_dump(mode='json')
        intent={key:value for key,value in payload.items() if key not in ('requestId','retryOf')}
        unknown=c.execute("""SELECT request_id,engine,error_code FROM uony_conversation_jobs
            WHERE user_id=%s AND status='unknown' AND acknowledged_at IS NULL
            AND google_subject=%s
            AND thread_id=%s AND jsonb_strip_nulls(payload-ARRAY['requestId','retryOf'])=
                jsonb_strip_nulls(%s::jsonb)
            ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
            (user['id'],user['google_subject'],body.threadId,Jsonb(intent))).fetchone()
        if unknown and c.execute('''SELECT 1 FROM uony_semantic_requests r
            JOIN uony_conversation_jobs completed ON completed.user_id=r.user_id
              AND completed.request_id=r.business_request_id AND completed.status='success'
            WHERE r.user_id=%s AND r.logical_request_id=%s''',
            (user['id'], unknown['request_id'])).fetchone():
            # Explicit recovery completed the old business request. Its uncertain
            # inference receipt remains unchanged; a fresh instruction is fresh.
            unknown = None
        if unknown:
            if unknown['error_code']=='restore_reconciliation_required':
                raise error('restore_reconciliation_required',
                    'Esta petición procede de una copia restaurada. Hay que verificar su resultado antes de repetirla.')
            if body.retryOf!=unknown['request_id']:
                raise error('consumption_unknown',UNCONFIRMED_RETRY)
            if unknown['engine'] not in self.engines or unknown['engine'] not in allowed:
                raise error('engine_unavailable',
                    'El motor del intento anterior no está disponible. Conservamos la petición incierta sin reconocerla ni cambiar de motor.')
            c.execute("""UPDATE uony_conversation_jobs SET acknowledged_at=now()
                WHERE user_id=%s AND request_id=%s""",(user['id'],unknown['request_id']))
            # Explicit retry keeps the uncertain attempt's engine across deployments.
            engine=unknown['engine']
        elif body.retryOf:
            raise error('invalid_retry','La petición indicada no corresponde a una ejecución incierta de este mensaje.')
        active = c.execute("""SELECT available_at=%s::timestamptz AS parked FROM uony_conversation_jobs
            WHERE user_id=%s AND status IN ('queued','running')""", (PARKED_UNTIL, user['id'])).fetchall()
        if parked and any(row['parked'] for row in active):
            raise error('followup_busy', 'Ya hay una orden esperando a que termine el trabajo en curso.')
        if active and not parked:
            raise error('busy', 'Uony todavía está atendiendo tu petición anterior.')
        parked = bool(active)
        focus_id, focus_version = focus_snapshot(c, user, body.threadId)
        expected_focus = getattr(body, 'expectedAssignmentFocus', None)
        if focus_id and expected_focus is None: raise error('assignment_focus_required',
            'Actualiza el encargo seleccionado antes de enviar este mensaje.')
        if expected_focus and (focus_id, focus_version) != (
                expected_focus.assignmentId, expected_focus.version):
            raise error('assignment_focus_conflict',
                        'El encargo seleccionado cambió. Actualiza antes de continuar.')
        self.require_global_capacity(c)
        c.execute("""INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,status,model,
            project_id,requested_model,effort,selection_reason,product_context)
            VALUES(%s,%s,%s,%s,'running',%s,%s,%s,%s,%s,%s)""",
            (user['id'],body.requestId,body.threadId,body.text,selected,cloud['project_id'],
             body.model,body.effort,reason,Jsonb(body.productContext.model_dump() if body.productContext else None)))
        c.execute("""INSERT INTO uony_conversation_jobs(user_id,request_id,thread_id,
            google_subject,project_id,payload,memory_snapshot,retry_of,engine,status,
            assignment_focus_pinned,assignment_focus_id,assignment_focus_version,available_at)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,'queued',true,%s,%s,
                   CASE WHEN %s THEN %s::timestamptz ELSE now() END)""",
            (user['id'],body.requestId,body.threadId,user['google_subject'],cloud['project_id'],
             Jsonb(payload),Jsonb(memory),body.retryOf,engine,focus_id,focus_version,parked,PARKED_UNTIL))
        return self.pending(body.requestId, body.threadId, 'queued')

    @staticmethod
    def pending(request_id, thread_id, status):
        return {'requestId':str(request_id),'threadId':thread_id,'status':status,
                'pollUrl':f'/api/uony/requests/{request_id}'}

    @staticmethod
    def progress(row):
        def millis(start, end):
            if start is None or end is None:
                return None
            return max(0, round((end-start).total_seconds()*1000))
        pairs={'queueMs':('created_at','first_claimed_at'),
               'preparationMs':('last_claimed_at','provider_started_at'),
               'googleMs':('provider_started_at','provider_returned_at'),
               'checkingMs':('provider_returned_at','finished_at'),
               'totalMs':('created_at','finished_at')}
        timings={name:value for name,(start,end) in pairs.items()
                 if (value:=millis(row[start],row[end])) is not None}
        result={'stage':row['progress_stage'],'seq':row['progress_seq'],
                'timingsMs':timings}
        if row['status']=='running' and row['provisional_text']:
            result['provisional']={'text':row['provisional_text'],
                                   'seq':row['provisional_seq'],'tentative':True}
        return result

    @staticmethod
    def response(row):
        return {'reply':row['reply'],'model':row['model'],'effort':row['effort'],
            'selectionReason':row['selection_reason'],'productChanges':row['product_changes'],
            'connectionActions':row['connection_actions'],'conversationForm':row['conversation_form'],
            **({'productProposal':row['product_proposal']} if row['product_proposal'] else {}),
            **({'materialAnalysis':row['material_analysis']} if row['material_analysis'] else {}),
            **({'productIntake':row['product_intake']} if row['product_intake'] else {})}

    @staticmethod
    def visible(c, user, request_id):
        return c.execute("""SELECT j.*,r.prompt,r.reply,r.model,r.effort,r.selection_reason,
            r.product_changes,r.connection_actions,r.conversation_form,r.material_analysis,
            r.product_proposal,
            r.product_intake,r.usage AS request_usage,r.error_code AS request_error,
            h.turn_id AS source_live_turn_id,h.session_id AS source_live_session_id
            FROM uony_conversation_jobs j JOIN uony_requests r
            ON r.user_id=j.user_id AND r.request_id=j.request_id
            LEFT JOIN uony_live_handoffs h
            ON h.user_id=j.user_id AND h.request_id=j.request_id
            JOIN uony_threads t ON t.user_id=j.user_id AND t.id=j.thread_id
            WHERE j.user_id=%s AND j.request_id=%s AND j.google_subject=%s
            AND t.deleted_at IS NULL""",
            (user['id'],request_id,user['google_subject'])).fetchone()

    def inspect(self, c, user, request_id):
        row = self.visible(c, user, request_id)
        if not row:
            raise error('request_not_found', 'No se encuentra esta petición en tu cuenta.', 404)
        result = self.pending(row['request_id'],row['thread_id'],row['status'])
        from .uony_semantic_recovery_store import metadata
        recovery = metadata(c, user, request_id)
        if recovery is not None:
            result['semanticRecovery'] = recovery
        if row['source_live_turn_id']:
            result['sourceLiveTurnId']=str(row['source_live_turn_id'])
            result['sourceLiveSessionId']=str(row['source_live_session_id'])
        result['progress']=self.progress(row)
        if row['status']=='success':
            result['response']=self.response(row)
            focus=created_focus(c,user,row['request_id'],row['thread_id'])
            if focus: result['response']['createdAssignmentFocus']=focus
        elif row['status'] in ('error','unknown','cancelled'):
            code = row['error_code'] or 'google_unavailable'
            provider_code = row['provider_error_code']
            from .uony_written_failure import released_unknown_text  # Local: it imports this module.
            released = released_unknown_text(row['status'], row['engine'], code, row['acknowledged_at'],
                                             row['source_live_turn_id'], provider_code)
            result['error']={'code':code,'message':released or failure_message(code,provider_code)}
            failure = saved_semantic_failure(row['request_usage'])
            if failure is not None and row['source_live_turn_id']:
                result['semanticFailure'] = {**failure,
                    'threadId': row['thread_id'], 'requestId': str(row['request_id']),
                    'turnId': str(row['source_live_turn_id'])}
                result['error'].update(code=failure['code'], message=failure['message'])
            if code=='consumption_unknown' and not released and provider_code in ('reauthorize','permission_denied'):
                result['error']['message']+=UNCONFIRMED_ACCESS
            card=failure_card(result['error']['code'],provider_code)
            if card:
                result['connectionActions']=card
                result['error']['connectionActions']=result['connectionActions']
        return result

    def recent(self, c, user):
        rows=c.execute("""SELECT j.request_id FROM uony_conversation_jobs j
            JOIN uony_threads t ON t.user_id=j.user_id AND t.id=j.thread_id
            WHERE j.user_id=%s AND j.google_subject=%s AND t.deleted_at IS NULL
            AND (j.created_at>now()-interval '7 days' OR j.status IN ('queued','running'))
            ORDER BY CASE WHEN j.status IN ('queued','running') THEN 0 ELSE 1 END,
                j.created_at DESC LIMIT 50""",
            (user['id'],user['google_subject'])).fetchall()
        result=[]
        for item in rows:
            row=self.visible(c,user,item['request_id'])
            if row:
                result.append({**self.inspect(c,user,item['request_id']),
                    'text':row['prompt'],'model':row['model'],'effort':row['effort'],
                    'createdAt':row['created_at'].isoformat()})
        return {'requests':result}

    def unresolved(self, c, user, after=None):
        cursor=None
        if after:
            cursor=c.execute("""SELECT created_at,request_id FROM uony_conversation_jobs
                WHERE user_id=%s AND google_subject=%s AND request_id=%s
                AND status='unknown' AND acknowledged_at IS NULL""",
                (user['id'],user['google_subject'],after)).fetchone()
            if not cursor:
                raise error('invalid_cursor','La página de peticiones inciertas ya no está disponible.',400)
        rows=c.execute("""SELECT j.request_id,j.created_at FROM uony_conversation_jobs j
            JOIN uony_threads t ON t.user_id=j.user_id AND t.id=j.thread_id
            WHERE j.user_id=%s AND j.google_subject=%s AND j.status='unknown'
            AND j.acknowledged_at IS NULL AND t.deleted_at IS NULL
            AND (%s::timestamptz IS NULL OR (j.created_at,j.request_id)<(%s::timestamptz,%s::uuid))
            ORDER BY j.created_at DESC,j.request_id DESC LIMIT 101""",
            (user['id'],user['google_subject'],cursor['created_at'] if cursor else None,
             cursor['created_at'] if cursor else None,cursor['request_id'] if cursor else None)).fetchall()
        page=rows[:100]
        requests=[]
        for item in page:
            row=self.visible(c,user,item['request_id'])
            if row:
                requests.append({**self.inspect(c,user,item['request_id']),
                    'text':row['prompt'],'model':row['model'],'effort':row['effort'],
                    'createdAt':row['created_at'].isoformat()})
        return {'requests':requests,'nextCursor':str(page[-1]['request_id']) if len(rows)>100 else None}

    def assert_lease(self, c, job):
        row=c.execute("""SELECT * FROM uony_conversation_jobs WHERE user_id=%s
            AND request_id=%s AND status='running' AND lease_token=%s
            AND lease_until>now() FOR UPDATE""",
            (job['user_id'],job['request_id'],job['lease_token'])).fetchone()
        if not row:
            raise LeaseLost()
        return row

    def _claim_once(self, worker_id):
        with self.database.connect() as c:
            # Start from due jobs, then lock the account before the second job
            # SELECT. The partial index avoids probing every registered user.
            # NO KEY UPDATE conflicts with other claimers; KEY SHARE does not.
            if frozenset(self.engines)==ENGINES:
                # Both schema-permitted engines are enabled. Omitting the
                # redundant filter lets PostgreSQL walk due jobs in one
                # global ready-time order instead of sorting both backlogs.
                engine_filter=''
                engines=()
            elif len(self.engines)==1:
                engine_filter=' AND j.engine=%s'
                engines=(self.engines[0],)
            else:
                engine_filter=' AND j.engine=ANY(%s::text[])'
                engines=(list(self.engines),)
            if self.disabled_adk_before is not None:
                engine_filter += " AND (j.engine<>'adk' OR j.created_at<=%s)"
                engines += (self.disabled_adk_before,)
            # Never a second running job for one account (D8 barrier, besides
            # the parked order's available_at).
            user=c.execute("""SELECT u.id FROM uony_conversation_jobs j
                JOIN users u ON u.id=j.user_id
                WHERE j.status='queued' AND j.available_at<=now()"""+
                engine_filter+""" AND u.deletion_requested_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM uony_conversation_jobs running
                    WHERE running.user_id=j.user_id AND running.status='running')
                ORDER BY j.available_at,j.created_at,j.user_id,j.request_id
                FOR NO KEY UPDATE OF u SKIP LOCKED LIMIT 1""",engines).fetchone()
            if not user:
                return None, False
            row=c.execute("""SELECT request_id FROM uony_conversation_jobs
                WHERE user_id=%s AND status='queued' AND available_at<=now()
                AND engine=ANY(%s::text[])
                """ + ("AND (engine<>'adk' OR created_at<=%s)" if
                        self.disabled_adk_before is not None else '') + """
                ORDER BY available_at,created_at
                FOR UPDATE SKIP LOCKED LIMIT 1""",
                (user['id'],list(self.engines)) + ((self.disabled_adk_before,) if
                    self.disabled_adk_before is not None else ())).fetchone()
            if not row:
                return None, True
            claimed = c.execute("""UPDATE uony_conversation_jobs SET status='running',
                lease_token=%s,lease_owner=%s,lease_until=now()+%s*interval '1 second',
                claim_count=claim_count+1,progress_stage='preparing',
                progress_seq=progress_seq+1,
                first_claimed_at=coalesce(first_claimed_at,now()),last_claimed_at=now(),
                updated_at=now() WHERE user_id=%s AND request_id=%s RETURNING *""",
                (uuid4(),worker_id,self.recovery_policy.lease_seconds,user['id'],row['request_id'])).fetchone()
            c.execute("""UPDATE uony_conversation_recoveries SET resumed_at=now()
                WHERE user_id=%s AND request_id=%s AND claim_count=%s
                AND outcome='queued' AND resumed_at IS NULL""",
                (claimed['user_id'],claimed['request_id'],claimed['claim_count']-1))
            return claimed, False

    def provider_start(self, job):
        with self.database.connect() as c:
            self.assert_lease(c,job)
            row=c.execute("""UPDATE uony_conversation_jobs SET provider_started_at=now(),
                usage='{"attemptedCalls":1,"uncertainCalls":1}'::jsonb,
                provider_attempt_count=1,
                progress_stage='consulting_google',progress_seq=progress_seq+1,
                updated_at=now() WHERE user_id=%s AND request_id=%s
                AND provider_started_at IS NULL RETURNING request_id""",
                (job['user_id'],job['request_id'])).fetchone()
            if not row:
                raise LeaseLost()

    def stream_partial(self, job, prefix):
        if not isinstance(prefix,str) or not prefix or len(prefix)>16000:
            raise LeaseLost()
        with self.database.connect() as c:
            row=self.assert_lease(c,job)
            prior=row['provisional_text']
            if prefix==prior:
                return
            if not prefix.startswith(prior):
                raise LeaseLost()
            c.execute("""UPDATE uony_conversation_jobs SET provisional_text=%s,
                provisional_seq=provisional_seq+1,progress_seq=progress_seq+1,
                updated_at=now() WHERE user_id=%s AND request_id=%s""",
                (prefix,job['user_id'],job['request_id']))

    def stream_clear(self, job):
        with self.database.connect() as c:
            row=self.assert_lease(c,job)
            if row['provisional_text']:
                c.execute("""UPDATE uony_conversation_jobs SET provisional_text='',
                    provisional_seq=provisional_seq+1,progress_seq=progress_seq+1,
                    updated_at=now() WHERE user_id=%s AND request_id=%s""",
                    (job['user_id'],job['request_id']))

    def provider_return(self, job):
        with self.database.connect() as c:
            self.assert_lease(c,job)
            row=c.execute("""UPDATE uony_conversation_jobs SET provider_returned_at=now(),
                progress_stage='checking_result',progress_seq=progress_seq+1,
                updated_at=now() WHERE user_id=%s AND request_id=%s
                AND provider_started_at IS NOT NULL AND provider_returned_at IS NULL
                RETURNING request_id""",
                (job['user_id'],job['request_id'])).fetchone()
            if not row:
                raise LeaseLost()

    def terminal(self, c, job, status, code=None, usage=None, provider_code=None):
        row=self.assert_lease(c,job)
        cleaned=safe_usage(usage)
        if status=='unknown':
            cleaned=merge_usage(cleaned,row['usage'])
            attempted=max(cleaned.get('attemptedCalls',0),row['provider_attempt_count'],1)
            completed=min(attempted,max(cleaned.get('calls',0),row['provider_completed_count']))
            cleaned['attemptedCalls']=attempted
            cleaned['calls']=completed
            # With an attempt log, a 429 retried away consumed nothing (hallazgo B).
            logged=self.attempt_uncertainty(c,job)
            cleaned['uncertainCalls']=(max(1,logged['uncertain']) if logged else
                max(1,cleaned.get('uncertainCalls',0),attempted-completed))
        final=Jsonb(cleaned)
        c.execute("""UPDATE uony_conversation_jobs SET status=%s,error_code=%s,
            provider_error_code=%s,
            usage=%s,provider_completed_at=now(),finished_at=now(),provisional_text='',
            progress_stage=CASE WHEN %s='success' THEN 'saved' ELSE progress_stage END,
            progress_seq=progress_seq+1,lease_token=NULL,lease_owner=NULL,
            lease_until=NULL,updated_at=now() WHERE user_id=%s AND request_id=%s""",
            (status,code,provider_code,final,status,job['user_id'],job['request_id']))
        if status!='success':
            c.execute("""UPDATE uony_requests SET status='error',error_code=%s,usage=%s
                WHERE user_id=%s AND request_id=%s""",
                (code,final,job['user_id'],job['request_id']))
        self.release_parked(c, job['user_id'])

    def cancel(self, c, user, request_id):
        job=c.execute("""SELECT * FROM uony_conversation_jobs WHERE user_id=%s
            AND request_id=%s AND google_subject=%s FOR UPDATE""",
            (user['id'],request_id,user['google_subject'])).fetchone()
        if not job:
            raise error('request_not_found','No se encuentra esta petición en tu cuenta.',404)
        if job['status'] in ('queued','running'):
            status='unknown' if job['provider_started_at'] else 'cancelled'
            attempted=max(1,job['provider_attempt_count'])
            completed=min(attempted,job['provider_completed_count'])
            usage=(merge_usage({'attemptedCalls':attempted,'calls':completed,
                    'uncertainCalls':max(1,attempted-completed)},job['usage']) if status=='unknown' else
                   {'attemptedCalls':0,'uncertainCalls':0})
            c.execute("""UPDATE uony_conversation_jobs SET status=%s,error_code=%s,
                usage=%s,provisional_text='',progress_seq=progress_seq+1,finished_at=now(),
                lease_token=NULL,lease_owner=NULL,lease_until=NULL,updated_at=now()
                WHERE user_id=%s AND request_id=%s""",
                (status,'consumption_unknown' if status=='unknown' else 'cancelled',
                 Jsonb(usage),job['user_id'],job['request_id']))
            c.execute("""UPDATE uony_requests SET status='error',error_code=%s,usage=%s
                WHERE user_id=%s AND request_id=%s""",
                ('consumption_unknown' if status=='unknown' else 'cancelled',
                 Jsonb(usage),job['user_id'],job['request_id']))
            self.release_parked(c, job['user_id'])
        return self.inspect(c,user,request_id)

    def metrics(self, c, user, *, project_id=None, window_seconds=3600, budgets=None):
        from .uony_queue_monitoring import queue_snapshot
        return queue_snapshot(c, user, project_id=project_id,
                              window_seconds=window_seconds, budgets=budgets)
