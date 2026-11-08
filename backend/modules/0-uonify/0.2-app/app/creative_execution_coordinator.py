"""Fenced creative primitives; no worker/API/dispatch is enabled here."""
from dataclasses import dataclass
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5
from psycopg.errors import LockNotAvailable
from psycopg.types.json import Jsonb
from .creative_candidate_completion import candidate_side_receipt_ready, lock_active_owner
from .creative_composite_quote import canonical_sha256
from .creative_craft_attempt_authority import bind_craft_attempt_authority
from .creative_execution_admission import _claim_set, revalidate_admission_claims

_TERMINAL_ATTEMPT_STATES = frozenset({
    'succeeded', 'failed', 'unknown', 'cancelled'})


class CreativeLeaseLost(RuntimeError):
    pass
@dataclass(frozen=True)
class CreativeAttemptClaim:
    user_id: str
    job_id: str
    step_id: str
    attempt_id: str
    attempt_no: int
    lease_token: str
    fence_epoch: int
    kind: str
    provider_call: bool
    admission_sha256: str
    claim_set_sha256: str
    execution_authorized: bool = False
    publication_authorized: bool = False

def _worker_id(value: object) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 160:
        raise ValueError('La identidad del worker creativo no es válida.')
    return value.strip()

def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f'{label} no es UUID.') from None
    return parsed

def _rollout_users(settings, attribute: str) -> tuple[str, ...]:
    values = getattr(settings, attribute, ())
    if not isinstance(values, (tuple, list)):
        raise ValueError('La política creativa del servidor no es válida.')
    try:
        users = tuple(str(UUID(value)) for value in values)
    except (TypeError, ValueError, AttributeError):
        raise ValueError('La política creativa del servidor no es válida.') from None
    if len(users) != len(set(users)):
        raise ValueError('La política creativa del servidor no es válida.')
    return users


def _craft_references(recipe: object) -> tuple[tuple[UUID, int], ...]:
    if not isinstance(recipe, dict) or not isinstance(recipe.get('assets', []), list):
        raise ValueError('La receta Craft persistida no es verificable.')
    result = []
    for item in recipe.get('assets', []):
        if (not isinstance(item, dict) or set(('assetId', 'revision')) - set(item)
                or not isinstance(item['revision'], int)
                or isinstance(item['revision'], bool)):
            raise ValueError('La receta Craft no liga assets vigentes.')
        result.append((UUID(_uuid(item['assetId'], 'assetId')), item['revision']))
    return tuple(result)


def _claim_snapshot(c, owner: dict, row: dict) -> tuple[list[dict], str]:
    if row['kind'] != 'craft':
        return row['input_claims'], row['input_claim_set_sha256']
    return _claim_set(c, owner, row['uonify_project_id'],
                      _craft_references(row['edit_recipe']))


def _mark_unknown(c, attempt: dict, code: str) -> None:
    key = (attempt['user_id'], attempt['job_id'], attempt['step_id'])
    c.execute('''UPDATE creative_execution_attempts SET status='unknown',
        error_code=%s,finished_at=clock_timestamp(),updated_at=clock_timestamp(),
        lease_token=NULL,lease_owner=NULL,lease_until=NULL
        WHERE user_id=%s AND job_id=%s AND step_id=%s AND attempt_no=%s''',
        (code, *key, attempt['attempt_no']))
    c.execute('''UPDATE creative_execution_steps SET status='unknown',
        error_code=%s,finished_at=clock_timestamp(),updated_at=clock_timestamp(),
        lease_token=NULL,lease_owner=NULL,lease_until=NULL
        WHERE user_id=%s AND job_id=%s AND step_id=%s''', (code, *key))
    c.execute('''UPDATE creative_execution_steps SET status='cancelled',
        error_code='blocked_by_unknown',finished_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE user_id=%s AND job_id=%s
        AND status IN ('held','queued')''', key[:2])
    c.execute('''UPDATE creative_execution_jobs SET status='unknown',
        error_code=%s,finished_at=clock_timestamp(),updated_at=clock_timestamp(),
        lease_token=NULL,lease_owner=NULL,lease_until=NULL
        WHERE user_id=%s AND id=%s''', (code, *key[:2]))


def _mark_failed(c, attempt: dict, code: str) -> None:
    key = (attempt['user_id'], attempt['job_id'], attempt['step_id'])
    c.execute('''UPDATE creative_execution_attempts SET status='failed',error_code=%s,
        finished_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token=NULL,
        lease_owner=NULL,lease_until=NULL WHERE user_id=%s AND job_id=%s
        AND step_id=%s AND attempt_no=%s''', (code, *key, attempt['attempt_no']))
    c.execute('''UPDATE creative_execution_steps SET status='failed',error_code=%s,
        finished_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token=NULL,
        lease_owner=NULL,lease_until=NULL WHERE user_id=%s AND job_id=%s
        AND step_id=%s''', (code, *key))
    c.execute('''UPDATE creative_execution_steps SET status='cancelled',
        error_code='blocked_by_failed',finished_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE user_id=%s AND job_id=%s
        AND status IN ('held','queued')''', key[:2])
    c.execute('''UPDATE creative_execution_jobs SET status='failed',error_code=%s,
        finished_at=clock_timestamp(),updated_at=clock_timestamp(),lease_token=NULL,
        lease_owner=NULL,lease_until=NULL WHERE user_id=%s AND id=%s''',
        (code, *key[:2]))


# F9(c): error_codes de un storage_adopt 'failed' que son RECUPERABLES re-conduciendo (poll/cadencia/
# transitorio de red o bucket). Allowlist EXPLÍCITA, NO un LIKE 'veo_poll_%' (ese atraparía el
# DETERMINISTA 'veo_poll_input_invalid' [F8], que re-conducir no arregla). En el flujo real el terminal
# del step es 'claim_limit_reached' (record_unknown→F6 _retry→tope); los demás se incluyen por defensa.
_REQUEUEABLE_ADOPTION_ERRORS = (
    'claim_limit_reached', 'import_bucket_unknown', 'adoption_bucket_unknown',
    'adoption_unknown', 'veo_poll_unknown', 'adoption_context_unknown',
    # 29j-B: fallo INCIERTO del listado de staging (red/5xx/permiso) en adopt_from_staging → re-conducible
    # (el objeto fuente puede seguir en staging; 0 POST). El determinista ('staging_ambiguous',
    # 'staging_list_invalid', 'staging_absent_past_deadline') NO se re-conduce (re-listar no lo arregla).
    'staging_list_unknown',
    # F9(e): deterministas-pero-reconducibles TRAS un fix de código (el objeto fuente sigue en
    # staging; attempt #5+). 'adoption_rejected' llega discriminado ('adoption_rejected:http_<code>:
    # <reason>') → se acepta por LIKE en el guard, no en esta tupla de match exacto.
    'adoption_input_invalid', 'adoption_request_invalid')


def _parent_generation_exactly_one_succeeded(c, user_id, job_id) -> bool:
    """Prueba de que el clip se generó y se cobró de verdad: el padre google_generation del job tiene
    EXACTAMENTE un intento 'succeeded' DURABLE (provider_started_at + provider_returned_at + result_sha256
    + result_receipt.providerOperation). Invariante COMPARTIDO por requeue_failed_internal_step y el bypass
    hermético de admisión caducada (claim_creative_step): ambos re-conducen SOLO la adopción de un clip ya
    pagado, nunca una generación (igual que adoption_loader:101-107)."""
    parent = c.execute(
        '''SELECT count(*) n FROM creative_execution_steps g
           JOIN creative_execution_attempts a
             ON a.user_id=g.user_id AND a.job_id=g.job_id AND a.step_id=g.step_id
           WHERE g.user_id=%s AND g.job_id=%s AND g.kind='google_generation'
             AND g.status='succeeded' AND a.status='succeeded'
             AND a.provider_started_at IS NOT NULL
             AND a.provider_returned_at IS NOT NULL
             AND a.result_sha256 IS NOT NULL
             AND a.result_receipt IS NOT NULL
             AND (a.result_receipt->>'providerOperation') IS NOT NULL''',
        (user_id, job_id)).fetchone()
    return bool(parent and parent['n'] == 1)


def requeue_failed_internal_step(c, user_id, job_id, step_id) -> dict:
    """Re-encola un paso INTERNO storage_adopt 'failed' para re-conducir SOLO la adopción y recuperar
    un clip YA generado y pagado (su op Veo ya está done; el re-poll la obtiene). Transición de SISTEMA
    guardada, money-neutral e idempotente. La ejecuta la interfaz desde el contenedor api con OK del
    dueño, job a job; hoy NO existe otra vía (recover solo toma 'running'; _retry exige lease vivo).

    Hermético (bandera de GASTO):
    - NUNCA re-encola una generación: exige kind='storage_adopt' AND provider_call=false (la adopción
      es poll fetchPredictOperation GET + rewrite GCS → 0 POST Veo, 0 re-cargo). Re-abrir una
      generación podría re-POSTear = cargo; por eso el guard es doble.
    - Solo si el padre google_generation está 'succeeded' con EXACTAMENTE un intento 'succeeded' DURABLE
      (provider_started_at + provider_returned_at + result_sha256 + result_receipt.providerOperation),
      igual que el invariante de adoption_loader:101-107 → prueba de que se generó y se cobró de verdad.
    - Solo si el storage_adopt 'failed' con un error_code RECUPERABLE (allowlist), nunca un terminal
      determinista (input inválido, RAI, conflicto). 0 intentos 'running' en el job (sin claim activo).
    - Locks en orden (cuenta advisory → job → step), como el resto del coordinador. Sin DELETE (sin
      cascada FK); NO toca attempts (090: terminales inmutables; el intento nuevo lo crea el claim
      normal con output_prefix NULL, 137 ok). Idempotente: el UPDATE exige status='failed'.
    NOTA admisión: el claim posterior revalida la cotización (expires_at). Si ya caducó, el entrypoint de
    recuperación pasa allow_expired_admission=True al claim: el bypass HERMÉTICO (storage_adopt +
    provider_call=false + padre 1/1 succeeded) relaja SOLO la vigencia, NUNCA para una generación."""
    c.execute("SELECT pg_advisory_xact_lock(hashtextextended("
              "'uonify:account:'||%s::uuid::text,0))", (user_id,))
    if not lock_active_owner(c, user_id):
        return {'requeued': False, 'reason': 'owner_not_active'}
    job = c.execute('''SELECT id FROM creative_execution_jobs
        WHERE user_id=%s AND id=%s FOR UPDATE''', (user_id, job_id)).fetchone()
    if not job:
        return {'requeued': False, 'reason': 'job_not_found'}
    adopt = c.execute(
        '''SELECT step_id,error_code FROM creative_execution_steps
           WHERE user_id=%s AND job_id=%s AND step_id=%s AND kind='storage_adopt'
             AND provider_call=false AND status='failed'
             AND (error_code = ANY(%s) OR error_code LIKE 'adoption_rejected%%')
           FOR UPDATE''',
        (user_id, job_id, step_id, list(_REQUEUEABLE_ADOPTION_ERRORS))).fetchone()
    if not adopt:
        return {'requeued': False, 'reason': 'no_requeueable_adoption_step'}
    running = c.execute(
        '''SELECT 1 FROM creative_execution_attempts
           WHERE user_id=%s AND job_id=%s AND status='running' LIMIT 1''',
        (user_id, job_id)).fetchone()
    if running:
        return {'requeued': False, 'reason': 'job_has_running_attempt'}
    if not _parent_generation_exactly_one_succeeded(c, user_id, job_id):
        return {'requeued': False, 'reason': 'generation_not_exactly_one_succeeded'}
    step = c.execute(
        '''UPDATE creative_execution_steps SET status='queued',error_code=NULL,
           claim_count=0,finished_at=NULL,lease_token=NULL,lease_owner=NULL,
           lease_until=NULL,updated_at=clock_timestamp()
           WHERE user_id=%s AND job_id=%s AND step_id=%s AND kind='storage_adopt'
             AND provider_call=false AND status='failed' RETURNING step_id''',
        (user_id, job_id, step_id)).fetchone()
    if not step:
        return {'requeued': False, 'reason': 'adoption_step_not_failed'}
    c.execute(
        '''UPDATE creative_execution_jobs SET status='queued',error_code=NULL,
           available_at=clock_timestamp(),finished_at=NULL,lease_token=NULL,
           lease_owner=NULL,lease_until=NULL,updated_at=clock_timestamp()
           WHERE user_id=%s AND id=%s''', (user_id, job_id))
    return {'requeued': True, 'step_id': str(step['step_id']),
            'prior_error_code': adopt['error_code']}


def recover_expired_creative_attempts(c, *, max_claims: int = 3,
                                      transition_sink: list[dict] | None = None,
                                      craft_transition_client=None,
                                      excluded_kinds: tuple[str, ...] = (),
                                      ) -> dict:
    if not isinstance(max_claims, int) or not 1 <= max_claims <= 10:
        raise ValueError('El límite de recuperación no es válido.')
    if transition_sink is not None and not isinstance(transition_sink, list):
        raise ValueError('El receptor de transiciones no es válido.')
    if (not isinstance(excluded_kinds, tuple)
            or any(kind not in {
                'google_generation', 'storage_adopt', 'craft',
                'candidate_adopt', 'review'} for kind in excluded_kinds)
            or len(excluded_kinds) != len(set(excluded_kinds))):
        raise ValueError('La exclusión de recuperación no es válida.')
    owner = c.execute('''SELECT u.id FROM creative_execution_attempts a
        JOIN creative_execution_steps s ON s.user_id=a.user_id
          AND s.job_id=a.job_id AND s.step_id=a.step_id
        JOIN users u ON u.id=a.user_id
        WHERE a.status='running'
          AND NOT (s.kind=ANY(%s::text[]))
          AND (s.kind<>'craft' OR (a.provider_started_at IS NULL
               AND a.provider_returned_at IS NULL
               AND s.provider_started_at IS NULL
               AND s.provider_returned_at IS NULL))
          AND (a.lease_until IS NULL OR a.lease_until<=clock_timestamp())
        ORDER BY CASE
          WHEN s.kind<>'craft' THEN 0
          WHEN NOT EXISTS (
            SELECT 1 FROM creative_craft_launcher_reservations r
             WHERE r.user_id=a.user_id AND r.attempt_id=a.id)
            OR EXISTS (
              SELECT 1 FROM creative_craft_launcher_reservations r
               WHERE r.user_id=a.user_id AND r.attempt_id=a.id
                 AND r.compensation_status='compensated') THEN 1
          ELSE 2 END,
          a.lease_until,a.created_at,a.user_id
        LIMIT 1''',
        (list(excluded_kinds),)).fetchone()
    recovered = {'queued': 0, 'failed': 0, 'unknown': 0, 'succeeded': 0}
    if not owner:
        return recovered
    c.execute(
        "SELECT pg_advisory_xact_lock(hashtextextended(" 
        "'uonify:account:'||%s::uuid::text,0))", (owner['id'],))
    owner = c.execute('''SELECT u.id FROM users u
        WHERE u.id=%s AND EXISTS (
          SELECT 1 FROM creative_execution_attempts a
          JOIN creative_execution_steps s ON s.user_id=a.user_id
            AND s.job_id=a.job_id AND s.step_id=a.step_id
          WHERE a.user_id=u.id AND a.status='running'
            AND NOT (s.kind=ANY(%s::text[]))
            AND (s.kind<>'craft' OR (a.provider_started_at IS NULL
                 AND a.provider_returned_at IS NULL
                 AND s.provider_started_at IS NULL
                 AND s.provider_returned_at IS NULL))
            AND (a.lease_until IS NULL
                 OR a.lease_until<=clock_timestamp()))
        FOR NO KEY UPDATE OF u''',
        (owner['id'], list(excluded_kinds))).fetchone()
    if not owner:
        return recovered
    # Discover expired pre-provider Craft attempts without taking execution
    # row locks.  SQL 114 owns their full account -> user -> attempt advisory ->
    # job -> step -> attempt -> reservation lock order and their mutations.
    craft_rows = []
    if 'craft' not in excluded_kinds:
        craft_rows = c.execute('''SELECT a.*,s.kind,s.provider_call
            FROM creative_execution_attempts a
            JOIN creative_execution_steps s ON s.user_id=a.user_id
              AND s.job_id=a.job_id AND s.step_id=a.step_id
            JOIN creative_execution_jobs j ON j.user_id=a.user_id
              AND j.id=a.job_id
            WHERE a.user_id=%s AND a.status='running'
              AND s.kind='craft' AND s.provider_call
              AND a.provider_started_at IS NULL
              AND a.provider_returned_at IS NULL
              AND s.provider_started_at IS NULL
              AND s.provider_returned_at IS NULL
              AND (a.lease_until IS NULL
                   OR a.lease_until<=clock_timestamp())
              AND s.status='running' AND j.status='running'
              AND s.lease_until<=clock_timestamp()
              AND j.lease_until<=clock_timestamp()
              AND s.lease_token=a.lease_token AND j.lease_token=a.lease_token
            ORDER BY a.lease_until,a.created_at''',
            (owner['id'],)).fetchall()
    for attempt in craft_rows:
        from .creative_craft_transition_client import (
            CraftTransitionClientError, recover_craft_expired_prestart,
        )
        try:
            outcome = recover_craft_expired_prestart(
                c, craft_transition_client, str(attempt['user_id']),
                str(attempt['id']), max_claims)
        except CraftTransitionClientError as error:
            raise CreativeLeaseLost(
                'La recuperación Craft exige la autoridad SQL 114.') from error
        if outcome['outcome'] == 'cleanup_required':
            continue
        recovered[outcome['outcome']] += 1
        if transition_sink is not None:
            transition_sink.append({
                'user_id': attempt['user_id'], 'job_id': attempt['job_id'],
                'step_id': attempt['step_id'], 'id': attempt['id'],
                'attempt_no': attempt['attempt_no'],
                'claim_lease_token': attempt['claim_lease_token'],
                'fence_epoch': attempt['fence_epoch'], 'kind': 'craft',
                'provider_call': attempt['provider_call'],
                'admission_sha256': attempt['admission_sha256'],
                'claim_set_sha256': attempt['claim_set_sha256'],
                'terminal_status': outcome['terminalStatus'],
            })
    # Candidatos SIN lock, ordenados por (job_id,id) para un orden único entre
    # recuperaciones concurrentes. El bloqueo real se toma dentro del bucle en el
    # ORDEN GLOBAL job→step→intento (sentencias separadas), igual que la función
    # consume_and_provider_start, y se RE-VALIDA tras bloquear (el estado pudo cambiar
    # entre el snapshot y el lock). Ver contracts/craft-claim-deadlock-diagnosis-20261021.md §10.
    candidates = c.execute('''SELECT a.job_id,a.step_id,a.id
        FROM creative_execution_attempts a
        JOIN creative_execution_steps s ON s.user_id=a.user_id
          AND s.job_id=a.job_id AND s.step_id=a.step_id
        JOIN creative_execution_jobs j ON j.user_id=a.user_id
          AND j.id=a.job_id
        WHERE a.user_id=%s AND a.status='running'
          AND NOT (s.kind=ANY(%s::text[]))
          AND s.kind<>'craft'
          AND (a.lease_until IS NULL OR a.lease_until<=clock_timestamp())
          AND s.status='running' AND j.status='running'
          AND s.lease_until<=clock_timestamp()
          AND j.lease_until<=clock_timestamp()
          AND s.lease_token=a.lease_token AND j.lease_token=a.lease_token
        ORDER BY a.job_id,a.id''',
        (owner['id'], list(excluded_kinds))).fetchall()
    for cand in candidates:
        c.execute('''SELECT 1 FROM creative_execution_jobs
            WHERE user_id=%s AND id=%s FOR UPDATE''',
            (owner['id'], cand['job_id']))
        c.execute('''SELECT 1 FROM creative_execution_steps
            WHERE user_id=%s AND job_id=%s AND step_id=%s FOR UPDATE''',
            (owner['id'], cand['job_id'], cand['step_id']))
        attempt = c.execute('''SELECT a.*,s.kind,s.provider_call
            FROM creative_execution_attempts a
            JOIN creative_execution_steps s ON s.user_id=a.user_id
              AND s.job_id=a.job_id AND s.step_id=a.step_id
            JOIN creative_execution_jobs j ON j.user_id=a.user_id
              AND j.id=a.job_id
            WHERE a.user_id=%s AND a.id=%s AND a.status='running'
              AND NOT (s.kind=ANY(%s::text[]))
              AND s.kind<>'craft'
              AND (a.lease_until IS NULL OR a.lease_until<=clock_timestamp())
              AND s.status='running' AND j.status='running'
              AND s.lease_until<=clock_timestamp()
              AND j.lease_until<=clock_timestamp()
              AND s.lease_token=a.lease_token AND j.lease_token=a.lease_token
            FOR UPDATE OF a''',
            (owner['id'], cand['id'], list(excluded_kinds))).fetchone()
        if not attempt:
            continue
        key = (attempt['user_id'], attempt['job_id'], attempt['step_id'])
        if (attempt['provider_returned_at'] is not None
                and attempt['result_sha256'] is not None
                and attempt['result_receipt'] is not None):
            try:
                _promote_success(c, attempt)
            except CreativeLeaseLost:
                _mark_failed(c, attempt, 'result_integrity_failed')
                recovered['failed'] += 1
                terminal_status = 'failed'
            else:
                recovered['succeeded'] += 1
                terminal_status = 'succeeded'
        elif attempt['provider_started_at'] is not None:
            _mark_unknown(c, attempt, 'consumption_unknown')
            recovered['unknown'] += 1
            terminal_status = 'unknown'
        elif attempt['attempt_no'] >= max_claims:
            _mark_failed(c, attempt, 'claim_limit_reached')
            recovered['failed'] += 1
            terminal_status = 'failed'
        else:
            c.execute('''UPDATE creative_execution_attempts SET status='cancelled',
                error_code='pre_provider_interrupted',finished_at=clock_timestamp(),
                updated_at=clock_timestamp(),
                lease_token=NULL,lease_owner=NULL,lease_until=NULL
                WHERE user_id=%s AND job_id=%s AND step_id=%s AND attempt_no=%s''',
                (*key, attempt['attempt_no']))
            c.execute('''UPDATE creative_execution_steps SET status='queued',
                error_code=NULL,updated_at=clock_timestamp(),lease_token=NULL,
                lease_owner=NULL,lease_until=NULL
                WHERE user_id=%s AND job_id=%s AND step_id=%s''', key)
            c.execute('''UPDATE creative_execution_jobs SET status='queued',
                error_code=NULL,available_at=clock_timestamp(),
                updated_at=clock_timestamp(),
                lease_token=NULL,lease_owner=NULL,lease_until=NULL
                WHERE user_id=%s AND id=%s''', key[:2])
            recovered['queued'] += 1
            terminal_status = 'cancelled'
        if transition_sink is not None:
            transition_sink.append({
                'user_id': attempt['user_id'], 'job_id': attempt['job_id'],
                'step_id': attempt['step_id'], 'id': attempt['id'],
                'attempt_no': attempt['attempt_no'],
                'claim_lease_token': attempt['claim_lease_token'],
                'fence_epoch': attempt['fence_epoch'], 'kind': attempt['kind'],
                'provider_call': attempt['provider_call'],
                'admission_sha256': attempt['admission_sha256'],
                'claim_set_sha256': attempt['claim_set_sha256'],
                'terminal_status': terminal_status,
            })
        # Craft unknown outcomes retain their bytes for external
        # reconciliation.  Pre-provider stops drain through the separate
        # compensation/prestart-forget authority and have no terminal receipt.
        if (attempt['kind'] != 'craft'
                or attempt['provider_returned_at'] is not None):
            enqueue_runtime_reconciliation(c, CreativeAttemptClaim(
                str(attempt['user_id']), str(attempt['job_id']),
                str(attempt['step_id']), str(attempt['id']),
                attempt['attempt_no'], str(attempt['claim_lease_token']),
                attempt['fence_epoch'], attempt['kind'],
                attempt['provider_call'], attempt['admission_sha256'],
                attempt['claim_set_sha256']), terminal_status,
                craft_transition_client=craft_transition_client)
    return recovered


def enqueue_runtime_reconciliation(c, claim: CreativeAttemptClaim,
                                   terminal_status: str, *,
                                   craft_transition_client=None) -> None:
    """Persist exact runtime cleanup in the terminal transition transaction."""
    if (not isinstance(claim, CreativeAttemptClaim)
            or terminal_status not in _TERMINAL_ATTEMPT_STATES):
        raise CreativeLeaseLost('La reconciliación terminal no es válida.')
    row = c.execute('''SELECT a.status,a.job_id,a.step_id,a.attempt_no,
            a.claim_lease_token,a.fence_epoch,a.admission_sha256,
            a.claim_set_sha256,s.kind,s.provider_call
        FROM creative_execution_attempts a
        JOIN creative_execution_steps s ON s.user_id=a.user_id
          AND s.job_id=a.job_id AND s.step_id=a.step_id
        WHERE a.user_id=%s AND a.id=%s FOR SHARE OF a,s''',
        (claim.user_id, claim.attempt_id)).fetchone()
    if (not row or row['status'] != terminal_status
            or str(row['job_id']) != claim.job_id
            or str(row['step_id']) != claim.step_id
            or row['attempt_no'] != claim.attempt_no
            or str(row['claim_lease_token']) != claim.lease_token
            or row['fence_epoch'] != claim.fence_epoch
            or row['admission_sha256'] != claim.admission_sha256
            or row['claim_set_sha256'] != claim.claim_set_sha256
            or row['kind'] != claim.kind
            or row['provider_call'] != claim.provider_call):
        raise CreativeLeaseLost('La transición terminal no coincide con su fence.')
    if row['kind'] == 'craft':
        if craft_transition_client is None:
            raise CreativeLeaseLost(
                'La reconciliación Craft requiere la autoridad SQL instalada.')
        from .creative_craft_transition_client import (
            enqueue_craft_runtime_reconciliation)
        applied = enqueue_craft_runtime_reconciliation(
            c, craft_transition_client, claim.user_id, claim.attempt_id)
        if applied is not True:
            raise CreativeLeaseLost(
                'La autoridad SQL no aceptó la reconciliación Craft.')
        return
    if claim.kind == 'craft':
        raise CreativeLeaseLost(
            'La identidad del claim no coincide con el paso creativo.')
    c.execute('''INSERT INTO creative_runtime_reconciliation_outbox
        (user_id,attempt_id,job_id,step_id,attempt_no,claim_lease_token,
         fence_epoch,admission_sha256,claim_set_sha256,kind,provider_call,
         terminal_status)
        SELECT %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
        WHERE %s::text<>'craft'
        ON CONFLICT (user_id,attempt_id) DO NOTHING''',
        (claim.user_id, claim.attempt_id, claim.job_id, claim.step_id,
         claim.attempt_no, claim.lease_token, claim.fence_epoch,
         claim.admission_sha256, claim.claim_set_sha256, claim.kind,
         claim.provider_call, terminal_status, claim.kind))
    outbox = c.execute('''SELECT * FROM
        creative_runtime_reconciliation_outbox
        WHERE user_id=%s AND attempt_id=%s''',
        (claim.user_id, claim.attempt_id)).fetchone()
    if (not outbox or str(outbox['job_id']) != claim.job_id
            or str(outbox['step_id']) != claim.step_id
            or outbox['attempt_no'] != claim.attempt_no
            or str(outbox['claim_lease_token']) != claim.lease_token
            or outbox['fence_epoch'] != claim.fence_epoch
            or outbox['admission_sha256'] != claim.admission_sha256
            or outbox['claim_set_sha256'] != claim.claim_set_sha256
            or outbox['kind'] != claim.kind
            or outbox['provider_call'] != claim.provider_call
            or outbox['terminal_status'] != terminal_status):
        raise CreativeLeaseLost('El outbox terminal no coincide con su fence.')


def claim_runtime_reconciliation(database, claim: CreativeAttemptClaim,
                                 terminal_status: str, *,
                                 lease_seconds: int = 60) -> str | None:
    """Lease the exact terminal outbox row before touching runtime state."""
    if (not isinstance(lease_seconds, int)
            or not 15 <= lease_seconds <= 900):
        raise ValueError('El lease de reconciliación no es válido.')
    if claim.kind == 'craft':
        raise CreativeLeaseLost(
            'La reconciliación Craft se reclama mediante la autoridad ACK.')
    token = uuid4()
    with database.connect() as c:
        enqueue_runtime_reconciliation(c, claim, terminal_status)
        applied = c.execute('''UPDATE creative_runtime_reconciliation_outbox
            SET status='running',lease_token=%s,
                lease_until=clock_timestamp()+%s*interval '1 second',
                attempt_count=attempt_count+1,updated_at=clock_timestamp()
            WHERE user_id=%s AND attempt_id=%s AND terminal_status=%s
              AND kind<>'craft'
              AND (status='pending' OR
                   (status='running' AND lease_until<=clock_timestamp()))
            RETURNING lease_token''',
            (token, lease_seconds, claim.user_id, claim.attempt_id,
             terminal_status)).fetchone()
        if applied:
            return str(applied['lease_token'])
        row = c.execute('''SELECT status FROM
            creative_runtime_reconciliation_outbox
            WHERE user_id=%s AND attempt_id=%s AND terminal_status=%s
              AND kind<>'craft' ''',
            (claim.user_id, claim.attempt_id, terminal_status)).fetchone()
        if not row or row['status'] not in ('running', 'done'):
            raise CreativeLeaseLost('El outbox terminal no pudo reservarse.')
        return None


def complete_runtime_reconciliation(database, claim: CreativeAttemptClaim,
                                    terminal_status: str,
                                    lease_token: str) -> bool:
    """Finish cleanup only for the owner of the exact outbox lease."""
    if claim.kind == 'craft':
        raise CreativeLeaseLost(
            'La reconciliación Craft se completa con recibo físico ACK.')
    with database.connect() as c:
        applied = c.execute('''UPDATE creative_runtime_reconciliation_outbox
            SET status='done',lease_token=NULL,lease_until=NULL,
                completed_at=clock_timestamp(),updated_at=clock_timestamp(),
                last_error=NULL
            WHERE user_id=%s AND attempt_id=%s AND terminal_status=%s
              AND kind<>'craft' AND status='running' AND lease_token=%s
              RETURNING 1''',
            (claim.user_id, claim.attempt_id, terminal_status,
             lease_token)).fetchone()
    return bool(applied)


def retry_runtime_reconciliation(database, claim: CreativeAttemptClaim,
                                 terminal_status: str, lease_token: str,
                                 error: BaseException) -> bool:
    """Return a failed cleanup lease to the durable queue with backoff."""
    if claim.kind == 'craft':
        raise CreativeLeaseLost(
            'La reconciliación Craft se libera mediante la autoridad ACK.')
    with database.connect() as c:
        applied = c.execute('''UPDATE creative_runtime_reconciliation_outbox
            SET status='pending',lease_token=NULL,lease_until=NULL,
                last_error=%s,
                available_at=clock_timestamp()
                  + LEAST(3600,power(2,attempt_count))*interval '1 second',
                updated_at=clock_timestamp()
            WHERE user_id=%s AND attempt_id=%s AND terminal_status=%s
              AND kind<>'craft' AND status='running' AND lease_token=%s
              RETURNING 1''',
            (type(error).__name__[:120], claim.user_id, claim.attempt_id,
             terminal_status, lease_token)).fetchone()
    return bool(applied)


def _candidate(c, job_id: str | None,
               allowed_users: tuple[str, ...]) -> tuple[dict, dict] | None:
    if job_id:
        row = c.execute('''SELECT user_id FROM creative_execution_jobs
            WHERE id=%s AND status='queued'
              AND user_id=ANY(%s::uuid[])''',
            (job_id, list(allowed_users))).fetchone()
        if not row:
            return None
        owner = c.execute('''SELECT * FROM users WHERE id=%s
            FOR NO KEY UPDATE''', (row['user_id'],)).fetchone()
    else:
        owner = c.execute('''SELECT u.* FROM creative_execution_jobs j
            JOIN users u ON u.id=j.user_id
            WHERE j.status='queued' AND j.available_at<=clock_timestamp()
              AND j.dispatch_authorized=false
              AND j.user_id=ANY(%s::uuid[])
              AND u.deletion_requested_at IS NULL
              AND EXISTS (SELECT 1 FROM creative_execution_steps s
                  WHERE s.user_id=j.user_id AND s.job_id=j.id
                    AND s.status='queued')
            ORDER BY j.available_at,j.created_at,j.user_id,j.id
            FOR NO KEY UPDATE OF u SKIP LOCKED LIMIT 1''',
            (list(allowed_users),)).fetchone()
    if not owner or owner.get('deletion_requested_at'):
        return None
    params = [owner['id']]
    job_filter = ''
    if job_id:
        job_filter, params = ' AND j.id=%s', [owner['id'], job_id]
    row = c.execute('''SELECT j.*,s.step_id,s.ordinal,s.kind,s.depends_on,
        s.provider_call,s.request_operation_id,
        d.id AS admission_id,d.admission_sha256,d.input_claim_set_sha256,
        d.input_claims,q.uonify_project_id,q.edit_recipe,q.google_project_id
        FROM creative_execution_jobs j
        JOIN creative_execution_admissions d
          ON d.user_id=j.user_id AND d.job_id=j.id
        JOIN creative_execution_steps s
          ON s.user_id=j.user_id AND s.job_id=j.id
        JOIN creative_execution_approvals a
          ON a.user_id=j.user_id AND a.id=j.approval_id
        JOIN creative_execution_quotes q
          ON q.user_id=a.user_id AND q.id=a.quote_id
        WHERE j.user_id=%s AND j.status='queued'
          AND j.available_at<=clock_timestamp()
          AND j.dispatch_authorized=false AND s.status='queued' ''' + job_filter + '''
        ORDER BY j.available_at,j.created_at,s.ordinal
        FOR UPDATE OF j,s SKIP LOCKED LIMIT 1''', params).fetchone()
    return (owner, row) if row else None


def _fail_candidate(c, owner: dict, row: dict, code: str) -> None:
    c.execute('''UPDATE creative_execution_steps SET status='failed',
        error_code=%s,finished_at=clock_timestamp(),
        updated_at=clock_timestamp()
        WHERE user_id=%s AND job_id=%s AND step_id=%s AND status='queued' ''',
        (code, owner['id'], row['id'], row['step_id']))
    c.execute('''UPDATE creative_execution_steps SET status='cancelled',
        error_code='blocked_by_failed',finished_at=clock_timestamp(),
        updated_at=clock_timestamp()
        WHERE user_id=%s AND job_id=%s AND status IN ('held','queued')''',
        (owner['id'], row['id']))
    c.execute('''UPDATE creative_execution_jobs SET status='failed',
        error_code=%s,finished_at=clock_timestamp(),
        updated_at=clock_timestamp()
        WHERE user_id=%s AND id=%s AND status='queued' ''',
        (code, owner['id'], row['id']))


def claim_creative_step(c, settings, worker_id: str,
                        job_id: UUID | None = None, *,
                        lease_seconds: int = 90,
                        allow_expired_admission: bool = False
                        ) -> CreativeAttemptClaim | None:
    allowed = _rollout_users(settings, 'creative_execution_pilot_user_ids')
    if not allowed:
        raise ValueError('El coordinador creativo permanece desactivado.')
    worker = _worker_id(worker_id)
    if not isinstance(lease_seconds, int) or not 15 <= lease_seconds <= 900:
        raise ValueError('La duración del lease creativo no es válida.')
    selected = _candidate(
        c, _uuid(job_id, 'jobId') if job_id else None, allowed)
    if not selected:
        return None
    owner, row = selected
    try:
        # BYPASS HERMÉTICO (--allow-expired-admission): SOLO la adopción (storage_adopt, provider_call=
        # false ⇒ 0 POST Veo) de un clip YA generado+pagado (padre 1/1 succeeded durable) puede re-
        # conducirse tras caducar la admisión. revalidate relaja SOLO la vigencia (expiry); TODOS los
        # demás invariantes (shas de grafo/quote/binding/costs/claims/admisión) SIGUEN exigiéndose
        # byte-idénticos. NUNCA una generación (provider_call=true = re-POST = cargo): esa exige vigente.
        # Short-circuit: con la bandera en False (worker normal) el chequeo del padre NI se ejecuta.
        require_unexpired = not (
            allow_expired_admission and row['kind'] == 'storage_adopt'
            and not row['provider_call']
            and _parent_generation_exactly_one_succeeded(c, owner['id'], row['id']))
        revalidate_admission_claims(
            c, owner, row['id'], require_unexpired=require_unexpired)
        claims, claim_sha = _claim_snapshot(c, owner, row)
        dependency_states = c.execute('''SELECT step_id,status
            FROM creative_execution_steps WHERE user_id=%s AND job_id=%s''',
            (owner['id'], row['id'])).fetchall()
        states = {str(item['step_id']): item['status']
                  for item in dependency_states}
        if any(states.get(dependency) != 'succeeded'
               for dependency in row['depends_on']):
            raise ValueError('Dependencias creativas no terminadas.')
    except ValueError:
        _fail_candidate(c, owner, row, 'admission_invalid')
        return None
    previous = c.execute('''SELECT coalesce(max(attempt_no),0) n
        FROM creative_execution_attempts
        WHERE user_id=%s AND job_id=%s AND step_id=%s''',
        (owner['id'], row['id'], row['step_id'])).fetchone()['n']
    attempt_no = previous + 1
    lease_token = uuid4()
    attempt_id = uuid5(
        NAMESPACE_URL,
        f'uonify:creative-attempt:{row["id"]}:{row["step_id"]}:{attempt_no}')
    # §6 (clips-only, mundo 090): reserva-y-persiste el output_prefix durable del intento en el MISMO
    # INSERT (write-once, migración 134). Solo para una generación Google con llamada a proveedor que
    # liga su operación, y solo si el bucket de salida se resuelve del allowlist de config; si no, NULL
    # ⇒ el reader clips-only falla cerrado (no despacha). El operation_id del prefijo ==
    # s.request_operation_id: bisagra §6 (el reader reconstruye el MISMO prefijo desde esta fila). El
    # pre-chequeo de request_operation_id evita la rama de error del helper ⇒ nunca rompe este claim
    # compartido del mundo 090 (lectores inyectados, sin red en el lock del claim).
    output_prefix = None
    if (row['kind'] == 'google_generation' and row['provider_call']
            and row.get('request_operation_id')):
        from .creative_clips_only_attempt_prefix import \
            clips_only_attempt_output_prefix
        from .creative_clips_only_bucket import clips_only_output_bucket
        bucket = clips_only_output_bucket(
            settings, google_project=row.get('google_project_id'))
        if bucket:
            output_prefix = clips_only_attempt_output_prefix(
                step_kind=row['kind'], provider_call=row['provider_call'],
                request_operation_id=str(row['request_operation_id']),
                bucket=bucket, owner_user_id=str(owner['id']),
                attempt_id=str(attempt_id))
    attempt = c.execute('''INSERT INTO creative_execution_attempts
        (user_id,job_id,step_id,id,attempt_no,admission_id,
         admission_sha256,claim_set_sha256,claim_snapshot,status,
         claim_lease_token,lease_token,lease_owner,lease_until,fence_epoch,
         output_prefix)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,'running',%s,%s,%s,
               clock_timestamp()+%s*interval '1 second',%s,%s) RETURNING *''',
        (owner['id'], row['id'], row['step_id'], attempt_id, attempt_no,
         row['admission_id'], row['admission_sha256'], claim_sha,
         Jsonb(claims), lease_token, lease_token, worker, lease_seconds,
         attempt_no, output_prefix)).fetchone()
    step = c.execute('''UPDATE creative_execution_steps SET status='running',
        lease_token=%s,lease_owner=%s,lease_until=%s,claim_count=claim_count+1,
        updated_at=clock_timestamp()
        WHERE user_id=%s AND job_id=%s AND step_id=%s
          AND status='queued' RETURNING *''',
        (lease_token, worker, attempt['lease_until'], owner['id'], row['id'],
         row['step_id'])).fetchone()
    job = c.execute('''UPDATE creative_execution_jobs SET status='running',
        lease_token=%s,lease_owner=%s,lease_until=%s,claim_count=claim_count+1,
        updated_at=clock_timestamp()
        WHERE user_id=%s AND id=%s AND status='queued'
        RETURNING *''', (lease_token, worker, attempt['lease_until'], owner['id'],
                        row['id'])).fetchone()
    if not step or not job:
        raise CreativeLeaseLost('El paso cambió durante el claim.')
    return CreativeAttemptClaim(
        str(owner['id']), str(row['id']), str(row['step_id']), str(attempt_id),
        attempt_no, str(lease_token), attempt_no, row['kind'],
        row['provider_call'],
        row['admission_sha256'], claim_sha)


def _assert_lease(c, claim: CreativeAttemptClaim) -> dict:
    if not isinstance(claim, CreativeAttemptClaim):
        raise CreativeLeaseLost('El claim creativo no es válido.')
    # Orden global de bloqueos job→step→intento en SENTENCIAS SEPARADAS: un JOIN con
    # FOR UPDATE no garantiza el orden de adquisición (lo fija el plan), y el orden
    # intento→job cerraba un ciclo frente a creative_craft_input_consume_and_provider_start
    # (job→step→intento). El job va con FOR NO KEY UPDATE (su clave no cambia; absorbe el
    # endurecimiento), step e intento con FOR UPDATE. Ver
    # contracts/craft-claim-deadlock-diagnosis-20261021.md §10.
    seed = c.execute('''SELECT job_id,step_id FROM creative_execution_attempts
        WHERE user_id=%s AND id=%s''',
        (claim.user_id, claim.attempt_id)).fetchone()
    if not seed:
        raise CreativeLeaseLost('El lease creativo ya no está vigente.')
    c.execute('''SELECT 1 FROM creative_execution_jobs
        WHERE user_id=%s AND id=%s FOR NO KEY UPDATE''',
        (claim.user_id, seed['job_id']))
    c.execute('''SELECT 1 FROM creative_execution_steps
        WHERE user_id=%s AND job_id=%s AND step_id=%s FOR UPDATE''',
        (claim.user_id, seed['job_id'], seed['step_id']))
    row = c.execute('''SELECT a.*,s.status AS step_status,j.status AS job_status,j.graph_snapshot,
        s.kind,s.provider_call AS step_provider_call,
        s.lease_token AS step_lease,j.lease_token AS job_lease
        FROM creative_execution_attempts a
        JOIN creative_execution_steps s ON s.user_id=a.user_id
          AND s.job_id=a.job_id AND s.step_id=a.step_id
        JOIN creative_execution_jobs j ON j.user_id=a.user_id AND j.id=a.job_id
        WHERE a.user_id=%s AND a.id=%s AND a.status='running'
          AND a.lease_token=%s AND a.fence_epoch=%s
          AND a.lease_until>clock_timestamp()
        FOR UPDATE OF a''',
        (claim.user_id, claim.attempt_id, claim.lease_token,
         claim.fence_epoch)).fetchone()
    if (not row or row['step_status'] != 'running' or row['job_status'] != 'running'
            or str(row['step_lease']) != claim.lease_token
            or str(row['job_lease']) != claim.lease_token
            or str(row['user_id']) != claim.user_id
            or str(row['job_id']) != claim.job_id
            or str(row['step_id']) != claim.step_id
            or row['attempt_no'] != claim.attempt_no
            or row['fence_epoch'] != claim.fence_epoch
            or row['admission_sha256'] != claim.admission_sha256
            or row['claim_set_sha256'] != claim.claim_set_sha256
            or row['step_provider_call'] != claim.provider_call):
        raise CreativeLeaseLost('El lease creativo ya no está vigente.')
    return row


def renew_creative_lease(c, claim: CreativeAttemptClaim, *,
                         lease_seconds: int = 90) -> bool:
    if not isinstance(lease_seconds, int) or not 15 <= lease_seconds <= 900:
        raise ValueError('La duración del lease creativo no es válida.')
    try:
        row = _assert_lease(c, claim)
    except CreativeLeaseLost:
        return False
    until = c.execute("SELECT clock_timestamp()+%s*interval '1 second' value",
                      (lease_seconds,)).fetchone()['value']
    c.execute('''UPDATE creative_execution_attempts SET lease_until=%s,
        updated_at=clock_timestamp() WHERE user_id=%s AND id=%s''',
        (until, row['user_id'], row['id']))
    c.execute('''UPDATE creative_execution_steps SET lease_until=%s,
        updated_at=clock_timestamp()
        WHERE user_id=%s AND job_id=%s AND step_id=%s''',
        (until, row['user_id'], row['job_id'], row['step_id']))
    c.execute('''UPDATE creative_execution_jobs SET lease_until=%s,
        updated_at=clock_timestamp()
        WHERE user_id=%s AND id=%s''', (until, row['user_id'], row['job_id']))
    return True


def checkpoint_provider_started(
        database, settings, claim: CreativeAttemptClaim, *,
        craft_launcher_request_sha256: str | None = None) -> None:
    if not isinstance(claim, CreativeAttemptClaim):
        raise CreativeLeaseLost('El claim creativo no es válido.')
    allowed = _rollout_users(
        settings, 'creative_provider_dispatch_pilot_user_ids')
    if claim.user_id not in allowed:
        raise ValueError('El dispatch de proveedor creativo permanece desactivado.')
    with database.connect() as c:
        c.execute("SET LOCAL lock_timeout = '500ms'")
        try:
            if not (owner := lock_active_owner(c, claim.user_id)): raise CreativeLeaseLost('La cuenta propietaria ya no está vigente.')
            revalidate_admission_claims(c, owner, UUID(claim.job_id))
            row = _assert_lease(c, claim)
        except (LockNotAvailable, ValueError):
            raise CreativeLeaseLost('El claim debe confirmarse antes del checkpoint.') from None
        if not row['step_provider_call']: raise CreativeLeaseLost('El paso no requiere proveedor externo.')
        if row['provider_started_at'] is not None:
            raise CreativeLeaseLost('El efecto externo ya fue iniciado.')
        graph_version = (row.get('graph_snapshot') or {}).get('schemaVersion', 1)
        launcher_request_sha256 = None
        if row['kind'] == 'craft' and graph_version >= 2:
            try: bind_craft_attempt_authority(c, row['user_id'], row['id'])
            except ValueError: raise CreativeLeaseLost('El claim debe confirmarse antes del checkpoint.') from None
            launcher = c.execute('''SELECT reservation.dispatch_id,
                    reservation.request_sha256,reservation.authority_sha256,
                    reservation.profile_sha256,
                    reservation.reservation_receipt,
                    reservation.reservation_receipt_sha256,
                    reservation.reserved_at,intent.state AS intent_state
                FROM creative_craft_launcher_reservations reservation
                JOIN creative_craft_materialization_intents intent
                  ON intent.user_id=reservation.user_id
                 AND intent.intent_id=reservation.materialization_intent_id
                 AND intent.attempt_id=reservation.attempt_id
                WHERE reservation.user_id=%s AND reservation.attempt_id=%s
                  AND reservation.job_id=%s AND reservation.step_id=%s
                  AND reservation.attempt_no=%s
                  AND reservation.claim_lease_token=%s
                  AND reservation.fence_epoch=%s
                  AND reservation.admission_sha256=%s
                  AND reservation.claim_set_sha256=%s
                FOR SHARE OF reservation,intent''',
                (claim.user_id, claim.attempt_id, claim.job_id,
                 claim.step_id, claim.attempt_no, claim.lease_token,
                 claim.fence_epoch, claim.admission_sha256,
                 claim.claim_set_sha256)).fetchone()
            expected_launcher_receipt = None if not launcher else {
                'schemaVersion': 1,
                'dispatchId': str(launcher['dispatch_id']),
                'requestSha256': launcher['request_sha256'],
                'status': 'reserved',
                'authoritySha256': launcher['authority_sha256'],
                'profileSha256': launcher['profile_sha256'],
            }
            if (not launcher or launcher['intent_state'] != 'attached'
                    or launcher['reserved_at'] is None
                    or launcher['reservation_receipt']
                    != expected_launcher_receipt
                    or launcher['reservation_receipt_sha256']
                    != canonical_sha256(expected_launcher_receipt)):
                raise CreativeLeaseLost(
                    'El provider start requiere una reserva launcher exacta.')
            launcher_request_sha256 = launcher['request_sha256']
        if craft_launcher_request_sha256 is not None:
            if (not isinstance(craft_launcher_request_sha256, str)
                    or len(craft_launcher_request_sha256) != 64
                    or any(char not in '0123456789abcdef'
                           for char in craft_launcher_request_sha256)
                    or launcher_request_sha256 is None
                    or craft_launcher_request_sha256
                    != launcher_request_sha256):
                raise CreativeLeaseLost(
                    'La reserva del launcher no coincide con el claim.')
        c.execute('''UPDATE creative_execution_attempts
            SET provider_started_at=clock_timestamp(),
            usage='{"attemptedCalls":1,"uncertainCalls":1}'::jsonb,
            updated_at=clock_timestamp() WHERE user_id=%s AND id=%s''',
            (row['user_id'], row['id']))
        c.execute('''UPDATE creative_execution_steps
            SET provider_started_at=clock_timestamp(),
            updated_at=clock_timestamp()
            WHERE user_id=%s AND job_id=%s AND step_id=%s''',
            (row['user_id'], row['job_id'], row['step_id']))


def checkpoint_provider_returned(c, claim: CreativeAttemptClaim,
                                 receipt: dict, usage: dict) -> str:
    if not lock_active_owner(c, claim.user_id):
        raise CreativeLeaseLost('La cuenta propietaria ya no está vigente.')
    row = _assert_lease(c, claim)
    if (not row['step_provider_call'] or row['provider_started_at'] is None
            or row['provider_returned_at'] is not None
            or not isinstance(receipt, dict) or not receipt
            or not isinstance(usage, dict)):
        raise CreativeLeaseLost('El retorno del proveedor no es verificable.')
    result_sha = canonical_sha256(receipt)
    c.execute('''UPDATE creative_execution_attempts
        SET provider_returned_at=clock_timestamp(),
        provider_receipt=%s,result_receipt=%s,result_sha256=%s,
        usage=%s,updated_at=clock_timestamp()
        WHERE user_id=%s AND id=%s''',
        (Jsonb(receipt), Jsonb(receipt), result_sha, Jsonb(usage),
         row['user_id'], row['id']))
    c.execute('''UPDATE creative_execution_steps
        SET provider_returned_at=clock_timestamp(),
        provider_receipt=%s,updated_at=clock_timestamp()
        WHERE user_id=%s AND job_id=%s AND step_id=%s''',
        (Jsonb(receipt), row['user_id'], row['job_id'], row['step_id']))
    return result_sha


def _promote_success(c, row: dict) -> str:
    if (not isinstance(row.get('result_receipt'), dict)
            or canonical_sha256(row['result_receipt'])
            != row.get('result_sha256')
            or (row.get('provider_receipt') is not None
                and row['provider_receipt'] != row['result_receipt'])):
        raise CreativeLeaseLost('El recibo durable no coincide con su huella.')
    if not candidate_side_receipt_ready(c, row):
        raise CreativeLeaseLost('Falta el recibo lateral exacto del candidato.')
    key = (row['user_id'], row['job_id'], row['step_id'])
    c.execute('''UPDATE creative_execution_attempts SET status='succeeded',
        finished_at=clock_timestamp(),updated_at=clock_timestamp(),
        lease_token=NULL,lease_owner=NULL,
        lease_until=NULL WHERE user_id=%s AND id=%s''',
        (row['user_id'], row['id']))
    c.execute('''UPDATE creative_execution_steps SET status='succeeded',
        finished_at=clock_timestamp(),updated_at=clock_timestamp(),
        lease_token=NULL,lease_owner=NULL,
        lease_until=NULL WHERE user_id=%s AND job_id=%s AND step_id=%s''', key)
    steps = c.execute('''SELECT step_id,depends_on,status
        FROM creative_execution_steps WHERE user_id=%s AND job_id=%s
        ORDER BY ordinal FOR UPDATE''', key[:2]).fetchall()
    states = {str(item['step_id']): item['status'] for item in steps}
    promoted = []
    for step in steps:
        if (step['status'] == 'held'
                and all(states.get(item) == 'succeeded'
                        for item in step['depends_on'])):
            promoted.append(step['step_id'])
    if promoted:
        c.execute('''UPDATE creative_execution_steps SET status='queued',
            updated_at=clock_timestamp() WHERE user_id=%s AND job_id=%s
              AND step_id=ANY(%s::uuid[])''',
            (row['user_id'], row['job_id'], promoted))
    remaining = c.execute('''SELECT count(*) n FROM creative_execution_steps
        WHERE user_id=%s AND job_id=%s
          AND status IN ('held','queued','running')''', key[:2]).fetchone()['n']
    status = 'queued' if remaining else 'succeeded'
    c.execute('''UPDATE creative_execution_jobs SET status=%s,
        finished_at=CASE WHEN %s='succeeded' THEN clock_timestamp() ELSE NULL END,
        available_at=clock_timestamp(),updated_at=clock_timestamp(),
        lease_token=NULL,lease_owner=NULL,
        lease_until=NULL WHERE user_id=%s AND id=%s''',
        (status, status, row['user_id'], row['job_id']))
    return status


def complete_creative_step(c, claim: CreativeAttemptClaim) -> str:
    row = _assert_lease(c, claim)
    if (row['result_sha256'] is None or row['result_receipt'] is None
            or (row['step_provider_call']
                and row['provider_returned_at'] is None)):
        raise CreativeLeaseLost('El resultado no tiene recibo durable.')
    return _promote_success(c, row)


def complete_internal_step(c, claim: CreativeAttemptClaim,
                           receipt: dict) -> str:
    """Complete a server-local step without inventing a provider effect."""
    row = _assert_lease(c, claim)
    if (row['step_provider_call'] or not isinstance(receipt, dict) or not receipt
            or row['provider_started_at'] is not None):
        raise CreativeLeaseLost('El resultado interno no es verificable.')
    result_sha = canonical_sha256(receipt)
    c.execute('''UPDATE creative_execution_attempts SET result_receipt=%s,
        result_sha256=%s,updated_at=clock_timestamp()
        WHERE user_id=%s AND id=%s''',
        (Jsonb(receipt), result_sha, row['user_id'], row['id']))
    row['result_receipt'] = receipt
    row['result_sha256'] = result_sha
    return _promote_success(c, row)


# -- API pública estable --------------------------------------------------------------
# Promovida desde los nombres privados por recomendación del Consultor (26-10): contrato
# estable para importadores externos (p. ej. el runner clips-only / EnvelopeJournal). La
# implementación y los llamadores internos no cambian; estos son alias de solo-exportación.
assert_lease = _assert_lease
mark_unknown = _mark_unknown
mark_failed = _mark_failed
