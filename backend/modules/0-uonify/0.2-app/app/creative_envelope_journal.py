"""EnvelopeJournal concreto sobre el ledger 088/090 + registro 089 (STAGED + INERTE).

Implementa el Protocol `creative_google_envelope_v2.EnvelopeJournal` COMPONIENDO los
primitivos fenced que YA EXISTEN en el coordinador (`checkpoint_provider_started`,
`checkpoint_provider_returned`, `complete_creative_step`, `complete_internal_step`,
`mark_unknown`, `mark_failed`). No abre dispatch, no persiste bytes y no reescribe a
mano el SQL protegido por triggers salvo las transiciones NO terminales de reintento
(cancel-intento + re-encolar paso), que replican la forma exacta de
`recover_expired_creative_attempts`.

Cada checkpoint es del titular del lease vigente: el fence (`claim_lease_token` +
`fence_epoch`) se verifica con `assert_lease` antes de cualquier efecto. La
idempotencia por (job, step, attempt, estado) la garantizan los triggers 090
(`creative_execution_attempt_monotonic`): los intentos terminales son inmutables y los
checkpoints append-only, así que repetir un estado ya aplicado o es no-op (misma fila)
o choca con el trigger — nunca corrompe.

Semántica de `record_unknown` ANCLADA a la recuperación establecida
(`recover_expired_creative_attempts`, líneas 279-294): un intento con
`provider_returned_at` + recibo durable es PROMOVIBLE a éxito y NUNCA `unknown`; el
estado `unknown` es SOLO para un efecto incierto (provider_started y sin
provider_returned). El trigger 090 impone lo mismo, así que esta rama evita chocar con
él y, sobre todo, no pierde una operación facturada.

INERTE: `record_provider_started` pasa por `checkpoint_provider_started`, cerrado por
`creative_provider_dispatch_pilot_user_ids` (vacío por defecto) — sin piloto/flags no
escribe nada. El registro 089 de `record_succeeded` necesita un `asset_draft_resolver`
inyectado (lo aporta la unidad de adopción/import, aún no cableada); sin él, el camino
de adopción no es ejecutable.

Vuelve al Consultor para su verdict de código (envelope v2 C1, un-POST del caller, y
que `record_unknown` ramifique exactamente como la recuperación).
"""

from dataclasses import asdict

from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb

from .creative_asset_contract import bind_creative_asset
from .creative_composite_quote import canonical_sha256
from .creative_execution_coordinator import (
    CreativeAttemptClaim, CreativeLeaseLost, assert_lease, mark_failed,
    mark_unknown, checkpoint_provider_returned, checkpoint_provider_started,
    complete_creative_step, complete_internal_step)
from .creative_google_generation_authority import (
    GoogleGenerationAuthority, GoogleGenerationFence,
    google_generation_authority_snapshot, google_generation_fence_snapshot)
from .creative_storage_contracts import StorageReceipt


_GENERATION_KIND = 'google_generation'
_ADOPT_KIND = 'storage_adopt'
_SUPPORTED_KINDS = (_GENERATION_KIND, _ADOPT_KIND)


class EnvelopeJournalError(Exception):
    """El diario no puede escribir un checkpoint coherente con el ledger."""


class AdoptionRevisionConflict(EnvelopeJournalError):
    """La revisión 089 ya existe para esta identidad (UniqueViolation en el INSERT de
    `creative_asset_revisions`). Hardening del fix de entrega B: el `record_succeeded` de
    la adopción captura SOLO esta UniqueViolation y la convierte en un terminal NOMBRADO
    card-safe (`adoption_revision_conflict`); el resto de psycopg/lease se RE-LANZA (nunca
    se enmascara). Card-safe: el mensaje NO porta asset_id/sha/bucket/constraint. Con el
    fix del loader (asset_id por-generación) este choque ya NO ocurre en generación fresca;
    esto es defensa en profundidad contra cualquier colisión residual (evita el masking
    PRE_POST_UNCLASSIFIED + la quema del cap de claims que vimos en el job 13dbc4d5)."""


def _claim(authority: GoogleGenerationAuthority,
           fence: GoogleGenerationFence,
           kind: str = _GENERATION_KIND) -> CreativeAttemptClaim:
    """Reconstruye el claim fenced EXACTO desde la autoridad + el fence.

    `kind` es el del paso que se arrienda: `google_generation` (provider_call=True, el POST)
    o `storage_adopt` (INTERNO, provider_call=False, la adopción). `authority.source_step_id`
    es el step del propio paso (el context_loader lo fija al paso que arrienda). `provider_call`
    se deriva del kind: por eso en storage_adopt el attempt nunca tiene provider_returned_at, y
    una adopción interrumpida se re-encola (no se promueve hueca). `assert_lease` lo contrasta
    contra la fila viva.
    """
    if kind not in _SUPPORTED_KINDS:
        raise EnvelopeJournalError('Kind de paso no soportado por el diario.')
    google_generation_authority_snapshot(authority)
    google_generation_fence_snapshot(fence)
    return CreativeAttemptClaim(
        authority.owner_user_id, authority.job_id, authority.source_step_id,
        fence.attempt_id, fence.attempt_no, fence.claim_lease_token,
        fence.fence_epoch, kind, kind == _GENERATION_KIND,
        authority.admission_sha256, authority.claim_set_sha256)


def _handle_receipt(state: str, provider_operation: str | None) -> dict:
    """Recibo durable canónico del retorno del POST (el handle del proveedor, C1)."""
    if not isinstance(state, str) or not state:
        raise EnvelopeJournalError('Estado de proveedor no válido para el checkpoint.')
    receipt = {'schemaVersion': 1, 'providerState': state}
    if provider_operation is not None:
        if not isinstance(provider_operation, str) or not provider_operation.strip():
            raise EnvelopeJournalError('Handle de operación del proveedor no válido.')
        receipt['providerOperation'] = provider_operation
    return receipt


def _manifest_receipt(storage_receipts: tuple[StorageReceipt, ...]) -> dict:
    """Recibo durable del paso de adopción (lista exacta de objetos GCS finales)."""
    if (not isinstance(storage_receipts, tuple) or not storage_receipts
            or any(not isinstance(item, StorageReceipt) for item in storage_receipts)):
        raise EnvelopeJournalError('La adopción no trae recibos GCS finales.')
    return {'schemaVersion': 1,
            'outputs': [asdict(item) for item in storage_receipts]}


class CreativeExecutionEnvelopeJournal:
    """Diario fenced inyectable para `run_google_generation_step` / adopción.

    `database` abre transacciones cortas e independientes (como el runner y
    `renew_creative_lease`). `settings` lo exige `checkpoint_provider_started`
    (piloto fail-closed). `asset_draft_resolver(authority, fence, storage_receipts)
    -> (draft, revision, owner_project_id)` lo aporta la unidad de import/adopción para
    el registro 089; sin él, `record_succeeded` no puede persistir la revisión.
    `max_attempts` replica el tope de `recover_expired_creative_attempts` (por encima
    del tope, un reintento se convierte en fallo terminal en vez de re-encolar).
    """

    def __init__(self, database, settings, *, asset_draft_resolver=None,
                 kind: str = _GENERATION_KIND, max_attempts: int = 3) -> None:
        if not isinstance(max_attempts, int) or not 1 <= max_attempts <= 10:
            raise EnvelopeJournalError('El tope de intentos del diario no es válido.')
        if kind not in _SUPPORTED_KINDS:
            raise EnvelopeJournalError('Kind de paso no soportado por el diario.')
        self.database = database
        self.settings = settings
        self.asset_draft_resolver = asset_draft_resolver
        self.kind = kind
        self.max_attempts = max_attempts

    # -- Gate 119 + cabeza del plan -------------------------------------------------
    def gate119_plan_head(self, authority: GoogleGenerationAuthority,
                          fence: GoogleGenerationFence) -> None:
        # Gate 119 solo aplica al paso de proveedor (la generación). Un diario de otro kind
        # (p. ej. storage_adopt, que arranca en poll y nunca llama aquí) que lo invoque por
        # error debe fallar CLARO, no con un CreativeLeaseLost engañoso (limpieza Consultor).
        if self.kind != _GENERATION_KIND:
            raise EnvelopeJournalError(
                'Gate 119 solo aplica al paso de generación de proveedor.')
        claim = _claim(authority, fence, self.kind)
        with self.database.connect() as c:
            row = assert_lease(c, claim)
            graph = row.get('graph_snapshot') or {}
            # Cabeza del plan: el grafo retenido del job hashea EXACTAMENTE al
            # execution_graph de la autoridad (Gate 119: autoridad de entrada 118/119).
            if canonical_sha256(graph) != authority.execution_graph_sha256:
                raise CreativeLeaseLost(
                    'La cabeza del grafo no coincide con la autoridad (Gate 119).')
            if row['kind'] != self.kind or row['step_provider_call'] is not True:
                raise CreativeLeaseLost(
                    'El paso fenced no es una generación de proveedor.')

    # -- POST único: inicio / retorno / handoff -------------------------------------
    def record_provider_started(self, authority: GoogleGenerationAuthority,
                                fence: GoogleGenerationFence) -> None:
        # Cerrado por el piloto de dispatch (vacío por defecto): inerte sin activar.
        checkpoint_provider_started(self.database, self.settings, _claim(authority, fence, self.kind))

    def record_provider_returned(self, authority: GoogleGenerationAuthority,
                                 fence: GoogleGenerationFence, *, state: str,
                                 provider_operation: str | None) -> None:
        # C1: persiste el handle del proveedor ANTES de validar el handoff. El trigger
        # 090 impone provider_receipt == result_receipt y result_sha256 presente.
        claim = _claim(authority, fence, self.kind)
        receipt = _handle_receipt(state, provider_operation)
        with self.database.connect() as c:
            checkpoint_provider_returned(
                c, claim, receipt, {'attemptedCalls': 1, 'uncertainCalls': 0})

    def record_handoff_ready(self, authority: GoogleGenerationAuthority,
                            fence: GoogleGenerationFence, *,
                            handoff_sha256: str) -> None:
        # El handoff verificado cierra el paso de generación: el handle durable es el
        # resultado y se promueven los pasos dependientes (p. ej. storage_adopt).
        claim = _claim(authority, fence, self.kind)
        with self.database.connect() as c:
            complete_creative_step(c, claim)

    # -- Estados terminales / reintento ---------------------------------------------
    def record_unknown(self, authority: GoogleGenerationAuthority,
                       fence: GoogleGenerationFence, *, reason,
                       detail: str | None = None) -> None:
        claim = _claim(authority, fence, self.kind)
        with self.database.connect() as c:
            row = assert_lease(c, claim)
            if row['provider_returned_at'] is not None:
                # Handle durable ⇒ NO es unknown (recover_expired_creative_attempts
                # §279-290: returned+durable es promovible). Se deja el intento para que
                # la recuperación lo promueva; el envelope ya levantó EnvelopeUncertain y
                # el caller no re-POSTea. Nunca se pierde una operación facturada.
                return
            if row['provider_started_at'] is not None:
                mark_unknown(c, row, self._code(reason, detail))
                return
        # F6: 'unknown' EXIGE un efecto de proveedor incierto (provider_started y sin returned):
        # invariante de BD (090_creative_execution_admission:150-154) y contrato de este diario
        # (§21). Un paso storage_adopt (provider_call=False) NUNCA fija provider_started
        # (record_adopting solo asserta el lease), así que su incertidumbre (poll/import/adopción
        # SIN efecto durable) NO es 'unknown': nada se produjo ⇒ RE-ENCOLAR (envelope_journal:68);
        # por encima del tope, fallo terminal. Marcar 'unknown' aquí reventaría el trigger 090
        # (RaiseException) pre-POST. Se re-encola FUERA del `with` (txn/lease propios, sin anidar).
        self._retry(authority, fence, self._code(reason, detail))

    def record_failed(self, authority: GoogleGenerationAuthority,
                     fence: GoogleGenerationFence, *, reason,
                     detail: str | None = None) -> None:
        claim = _claim(authority, fence, self.kind)
        with self.database.connect() as c:
            row = assert_lease(c, claim)
            mark_failed(c, row, self._code(reason, detail))

    def record_rejected_retryable(self, authority: GoogleGenerationAuthority,
                                 fence: GoogleGenerationFence, *, reason,
                                 detail: str | None = None) -> None:
        # 408/429: nada producido; seguro reintentar con un intento nuevo.
        self._retry(authority, fence, self._code(reason, detail))

    def record_aborted(self, authority: GoogleGenerationAuthority,
                      fence: GoogleGenerationFence, *, reason,
                      detail: str | None = None) -> None:
        # Precondición pre-HTTP fallida: 0 HTTP garantizado por el envelope; re-encolar.
        self._retry(authority, fence, self._code(reason, detail))

    # -- Adopción (unidad posterior; registro 089) ----------------------------------
    def record_adopting(self, authority: GoogleGenerationAuthority,
                       fence: GoogleGenerationFence) -> None:
        # Checkpoint no terminal: el adoptante debe tener el lease vigente. No persiste
        # bytes; la durabilidad real llega con record_succeeded.
        claim = _claim(authority, fence, self.kind)
        with self.database.connect() as c:
            assert_lease(c, claim)

    def record_succeeded(self, authority: GoogleGenerationAuthority,
                        fence: GoogleGenerationFence, *,
                        storage_receipts: tuple[StorageReceipt, ...]) -> None:
        claim = _claim(authority, fence, self.kind)
        with self.database.connect() as c:
            row = assert_lease(c, claim)
            # Hardening fix entrega B: SOLO la UniqueViolation del INSERT de revisión 089 se
            # convierte en terminal NOMBRADO card-safe (AdoptionRevisionConflict); el resto de
            # psycopg se RE-LANZA (nunca se enmascara). El `with` hace rollback atómico del
            # INSERT parcial; el attempt queda 'running' (sin terminal) y el caller
            # (_import_adopt_record) lo cierra como 'adoption_revision_conflict' —NO como el
            # PRE_POST_UNCLASSIFIED crudo que dejaba el attempt colgado y quemaba el cap.
            try:
                self._persist_revisions(c, authority, fence, storage_receipts)
            except UniqueViolation:
                raise AdoptionRevisionConflict(
                    'La revisión 089 del asset ya existe para esta identidad.') from None
            # Con handle de proveedor (provider_returned) ⇒ complete_creative_step; un
            # paso interno (adopción create-only sin proveedor) ⇒ complete_internal_step
            # con el manifiesto de salidas. Se decide por la fila, no se adivina.
            if row['provider_returned_at'] is not None:
                complete_creative_step(c, claim)
            else:
                complete_internal_step(c, claim, _manifest_receipt(storage_receipts))

    # -- Internos -------------------------------------------------------------------
    @staticmethod
    def _code(reason, detail: str | None) -> str:
        value = getattr(reason, 'value', reason)
        if not isinstance(value, str) or not value:
            raise EnvelopeJournalError('Motivo del journal no válido.')
        return value[:120]

    def _retry(self, authority: GoogleGenerationAuthority,
               fence: GoogleGenerationFence, code: str) -> None:
        """Cancela ESTE intento y re-encola el paso (nada producido). Respeta el tope
        de intentos del coordinador: por encima de él, fallo terminal en vez de bucle."""
        claim = _claim(authority, fence, self.kind)
        with self.database.connect() as c:
            row = assert_lease(c, claim)
            if row['attempt_no'] >= self.max_attempts:
                mark_failed(c, row, 'claim_limit_reached')
                return
            key = (row['user_id'], row['job_id'], row['step_id'])
            c.execute('''UPDATE creative_execution_attempts SET status='cancelled',
                error_code=%s,finished_at=clock_timestamp(),updated_at=clock_timestamp(),
                lease_token=NULL,lease_owner=NULL,lease_until=NULL
                WHERE user_id=%s AND job_id=%s AND step_id=%s AND attempt_no=%s''',
                (code, *key, row['attempt_no']))
            c.execute('''UPDATE creative_execution_steps SET status='queued',
                error_code=NULL,updated_at=clock_timestamp(),lease_token=NULL,
                lease_owner=NULL,lease_until=NULL
                WHERE user_id=%s AND job_id=%s AND step_id=%s''', key)
            c.execute('''UPDATE creative_execution_jobs SET status='queued',
                error_code=NULL,available_at=clock_timestamp(),
                updated_at=clock_timestamp(),lease_token=NULL,lease_owner=NULL,
                lease_until=NULL WHERE user_id=%s AND id=%s''', key[:2])

    def _persist_revisions(self, c, authority: GoogleGenerationAuthority,
                          fence: GoogleGenerationFence,
                          storage_receipts: tuple[StorageReceipt, ...]) -> None:
        """Inserta en 089 la(s) revisión(es) inmutable(s) del asset adoptado.

        Usa el `asset_draft_resolver` inyectado (lo aporta la unidad de import) para
        obtener el draft, la revisión y el proyecto del dueño de cada recibo; liga todo
        con `bind_creative_asset` (identidad §H.3: bucket+name+generation+sha256) y
        persiste create-only. Sin resolver, la adopción no es ejecutable.
        """
        if self.asset_draft_resolver is None:
            raise EnvelopeJournalError(
                'La adopción 089 requiere un asset_draft_resolver inyectado.')
        if (not isinstance(storage_receipts, tuple) or not storage_receipts
                or any(not isinstance(item, StorageReceipt)
                       for item in storage_receipts)):
            raise EnvelopeJournalError('La adopción no trae recibos GCS finales.')
        for receipt in storage_receipts:
            resolved = self.asset_draft_resolver(authority, fence, receipt)
            draft, revision, owner_project_id = resolved
            snapshot = bind_creative_asset(
                draft, receipt, owner_user_id=authority.owner_user_id,
                owner_project_id=owner_project_id, revision=revision,
                source_step_id=authority.source_step_id,
                execution_graph_sha256=authority.execution_graph_sha256)
            self._insert_revision(c, snapshot, authority.job_id)

    @staticmethod
    def _insert_revision(c, snapshot, source_job_id: str) -> None:
        """Alta create-only en 089: asset + revisión inmutable, con current_revision
        apuntando a la última. Idempotente por el UNIQUE (user_id, snapshot_sha256).
        `source_job_id` viene de la autoridad (el snapshot solo porta source_step_id)."""
        receipt = snapshot.storage_receipt
        c.execute('''INSERT INTO creative_assets
            (user_id,id,uonify_project_id,current_revision,authorization_state)
            VALUES(%s,%s,%s,%s,'allowed')
            ON CONFLICT (user_id,id) DO UPDATE
                SET current_revision=GREATEST(
                        creative_assets.current_revision,EXCLUDED.current_revision),
                    updated_at=now()''',
            (snapshot.owner_user_id, snapshot.asset_id, snapshot.owner_project_id,
             snapshot.revision))
        c.execute('''INSERT INTO creative_asset_revisions
            (user_id,asset_id,revision,role,kind,mime_type,byte_size,sha256,
             storage_bucket,storage_name,storage_generation,media,lineage,
             craft_blockers,source_job_id,source_step_id,execution_graph_sha256,
             snapshot_sha256)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (user_id,snapshot_sha256) DO NOTHING''',
            (snapshot.owner_user_id, snapshot.asset_id, snapshot.revision,
             snapshot.role, snapshot.kind, snapshot.mime_type, snapshot.byte_size,
             snapshot.sha256, receipt.bucket, receipt.name, receipt.generation,
             Jsonb(snapshot.media), Jsonb(snapshot.lineage),
             Jsonb(list(snapshot.craft_blockers)), source_job_id,
             snapshot.source_step_id, snapshot.execution_graph_sha256,
             snapshot.snapshot_sha256))
