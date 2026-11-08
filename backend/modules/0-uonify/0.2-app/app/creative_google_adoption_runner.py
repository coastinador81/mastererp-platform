"""Unidad de import/adopción del clip Veo (clips-only, STAGED + INERTE).

Corre sobre el paso INTERNO `storage_adopt` (NO sobre `google_generation`), que el grafo 088
ya emite dependiente de la generación y que `record_handoff_ready` promueve tras el POST. Al
ser interno (provider_call=False) su attempt nunca tiene `provider_returned_at`: una adopción
interrumpida cae en re-encolado (no se promueve hueca) y el éxito solo llega por
`record_succeeded`→089+`complete_internal_step` que liga el asset atómicamente (verdict
Consultor §5, 26-10). Consulta UNA vez la operación (handle de la generación persistido),
inspecciona el objeto que Google escribió en GCS, lo adopta al nombre canónico create-only y
registra el éxito en 089 vía el EnvelopeJournal. COMPONE primitivos que ya existen (no hace
HTTP ni SQL propio):
`poll_veo_once` → `import_generated_video_once` → `provider_video_adoption_request` →
`adopt_provider_video_once` → `journal.record_succeeded`.

No reintenta `predictLongRunning` ni re-POSTea: un `unknown` queda para la recuperación
durable (el journal no marca unknown si el handle ya es durable); un resultado determinista
(RAI/failed, objeto inválido, rewrite rechazado) es terminal. Una continuación del rewrite
(objeto grande que no termina en un POST) devuelve `adopting_continuation` para que el runner
re-arriende, nunca un bucle aquí.

El `asset_id`, el `output_prefix` §6/129, el `operation_name` persistido y el token los aporta
un `GoogleAdoptionContextLoader` INYECTADO (lo cablea el context_loader, aún no construido);
esta unidad los consume, no los inventa. INERTE: sin handler registrado al arranque. Vuelve al
Consultor para su verdict de código.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Protocol, runtime_checkable

import requests

from .creative_envelope_journal import (AdoptionRevisionConflict,
                                        CreativeExecutionEnvelopeJournal,
                                        EnvelopeJournalError)
from .creative_execution_coordinator import (CreativeAttemptClaim,
                                             assert_lease, mark_failed)
from .creative_clips_only_token_provider import ClipsOnlyTokenError
from .google_cloud_provider import CloudError
from .creative_google_generation_authority import (GoogleGenerationAuthority,
                                                   GoogleGenerationFence)
from .creative_provider_adoption_transport import (
    ProviderAdoptionTransportConflict, ProviderAdoptionTransportError,
    ProviderAdoptionTransportUnknown, adopt_provider_video_once)
from .creative_provider_asset_adoption import (ProviderAdoptionRequest,
                                              provider_video_adoption_request)
from .creative_provider_storage_import import (ProviderStorageImportError,
                                              ProviderStorageImportUnknown,
                                              import_generated_video_once)
from .creative_provider_staging_list import (StagingListAmbiguous,
                                            StagingListInvalid,
                                            StagingListUnknown,
                                            select_staged_video_output)
from .creative_storage_contracts import StorageReceipt
from .creative_storage_transport import StorageTransportError
from .creative_veo_recovery import (VeoRecoveryNotFound, VeoRecoveryUnknown,
                                    poll_veo_once)


@dataclass(frozen=True)
class AdoptionContext:
    """Todo lo que la adopción necesita además de autoridad/fence (lo arma context_loader)."""
    project: str
    model: str
    operation_name: str
    token: str
    expected_output_prefix: str
    expected_location: str
    asset_id: str
    owner_project_id: str | None
    revision: int
    # 29j-B: instante del POST del padre (provider_started_at) para la ventana de render del
    # age-disambig de adopt_from_staging (0 objetos en staging: dentro de ventana ⇒ pending; pasada ⇒
    # terminal, nunca un bucle). None ⇒ no se puede acotar por tiempo (conservador: pending).
    parent_provider_started_at: datetime | None = None


@runtime_checkable
class GoogleAdoptionContextLoader(Protocol):
    def load(self, c, claim: CreativeAttemptClaim) -> tuple[
            GoogleGenerationAuthority, GoogleGenerationFence, AdoptionContext]:
        ...


@dataclass(frozen=True)
class AdoptionOutcome:
    state: str  # pending | adopted | failed | unknown | adopting_continuation
    reasons: tuple[str, ...] = ()
    storage_receipt: StorageReceipt | None = None


def run_google_adoption_once(
        database, settings, claim: CreativeAttemptClaim, *,
        context_loader: GoogleAdoptionContextLoader,
        session: requests.Session, max_attempts: int = 3) -> AdoptionOutcome:
    """Un intento de adopción: una consulta, a lo sumo un rewrite. Mapea cada final a la
    transición durable del journal y nunca re-POSTea la generación."""
    if not isinstance(claim, CreativeAttemptClaim) or claim.kind != 'storage_adopt':
        raise ValueError('El claim no es un paso de adopción (storage_adopt).')
    # F7.3: context_loader.load (1er paso del re-drive: refresh OAuth PATH A + rehidratación del
    # contexto) estaba FUERA de todo try → un error de contexto/token escapaba CRUDO → el hilo del
    # runner lo reporta 'raised' → worker UNCLASSIFIED + el attempt queda 'running' hasta caducar el
    # lease. Captúralo LIMPIO+NOMBRADO con el PROPIO claim (en una conexión nueva, como el journal;
    # aquí authority/fence AÚN no existen, pero el journal los reconstruye exactamente a este claim):
    # determinista (ValueError, incl. ClipsOnlyAdoptionLoaderError) → 'adoption_context_invalid'
    # [terminal]; transitorio (CloudError/ClipsOnlyTokenError = refresh OAuth/cloud) →
    # 'adoption_context_unknown' [RE-ENCOLABLE por la CLI de re-drive]. 0 POST (pre-poll), money-safe.
    # Una excepción INESPERADA (no estas clases) se RE-LANZA: la nombra F4, no se enmascara.
    context_failure = None
    with database.connect() as c:
        try:
            authority, fence, ctx = context_loader.load(c, claim)
        except (CloudError, ClipsOnlyTokenError):
            context_failure = 'adoption_context_unknown'
        except ValueError:
            context_failure = 'adoption_context_invalid'
    if context_failure is not None:
        with database.connect() as c:
            mark_failed(c, assert_lease(c, claim), context_failure)
        return AdoptionOutcome('failed', (context_failure,))
    if not isinstance(ctx, AdoptionContext):
        raise ValueError('El contexto de adopción no es canónico.')
    journal = CreativeExecutionEnvelopeJournal(
        database, settings, kind='storage_adopt', max_attempts=max_attempts)

    # DECISIÓN UX/COMPORTAMIENTO DEL DUEÑO (marcada, NO inventada — caveat del Consultor §5):
    # en storage_adopt, record_unknown es TERMINAL (provider_returned_at None). El gasto ya
    # quedó preservado en la generación y la adopción es idempotente (create-only + _reconcile),
    # así que la incertidumbre de adopción PODRÍA mapearse a REINTENTO (record_rejected_retryable)
    # en vez de unknown terminal; ambas son seguras. Aquí se mantiene la conservadora (unknown);
    # el dueño decide si prefiere reintento para recuperar el clip ante un fallo transitorio.

    # 1) Una sola consulta de la operación (recovery con el prefijo persistido).
    try:
        poll = poll_veo_once(ctx.project, ctx.model, ctx.operation_name, ctx.token,
                             session, ctx.expected_output_prefix)
    except VeoRecoveryNotFound:
        journal.record_unknown(authority, fence, reason='veo_operation_not_found')
        return AdoptionOutcome('unknown', ('veo_operation_not_found',))
    except VeoRecoveryUnknown as error:
        # F9 (discriminador en el REASON — _code descarta `detail`, envelope_journal:246): nombra la
        # rama del fallo de poll SIN exponer URL/body/token/operationName. `name_mismatch` añade la
        # FORMA del proyecto (id|number|other) + si `done` estaba presente, para zanjar :100 (done
        # ausente) vs :97 (name) en el re-drive sin adivinar a ciegas.
        branch = getattr(error, 'branch', 'unknown')
        status = getattr(error, 'http_status', None)
        if branch == 'http' and isinstance(status, int):
            reason = 'veo_poll_http_%d' % status
        elif branch == 'name_mismatch':
            reason = 'veo_poll_name_mismatch:form_%s:done_%d' % (
                getattr(error, 'name_form', 'other'),
                1 if getattr(error, 'done_present', False) else 0)
        elif branch == 'bad_json':
            reason = 'veo_poll_json'
        elif branch in ('network', 'output_invalid'):
            reason = 'veo_poll_%s' % branch
        else:
            reason = 'veo_poll_unknown'
        journal.record_unknown(authority, fence, reason=reason)
        return AdoptionOutcome('unknown', (reason,))
    # F8 (simétrico con F7): poll_veo_once lanza ValueError ANTES de su try interno
    # (_operation_location:24 location no autorizada; guard de token :70 token vacío) — NO es
    # VeoRecovery* → escapaba este try → crudo → UNCLASSIFIED ciego (3er gap REA, misma clase).
    # Determinista (contrato interno) → record_failed LIMPIO+NOMBRADO (090-safe). veo_recovery_request
    # NO lanza (solo construye+devuelve, verificado). Cierra «sin UNCLASSIFIED ciego en la adopción».
    except ValueError:
        journal.record_failed(authority, fence, reason='veo_poll_input_invalid')
        return AdoptionOutcome('failed', ('veo_poll_input_invalid',))
    if not poll.done:
        return AdoptionOutcome('pending')
    if poll.status != 'completed' or not poll.outputs:
        # done + failed / RAI / sin medios: rechazo determinista (ficha veo §2.4, U7).
        reasons = poll.reasons or ('veo_result_failed',)
        journal.record_failed(authority, fence, reason='veo_result_failed',
                             detail=';'.join(reasons)[:120])
        return AdoptionOutcome('failed', reasons)

    # 2) Adoptar el único clip (clips-only = 1 vídeo).
    return _import_adopt_record(
        journal, authority, fence, ctx, poll.outputs[0], session)


def _import_adopt_record(journal, authority, fence, ctx: AdoptionContext,
                         output, session: requests.Session) -> AdoptionOutcome:
    """Import→request→adopt→record del ÚNICO vídeo. Camino endurecido COMPARTIDO por la adopción normal
    (poll_veo_once) y la recuperación por staging (adopt_from_staging): misma taxonomía F7/F7.2/F9e, misma
    integridad auto-consistente (bytes/md5/crc32c/MP4 que verifica import_generated_video_once + rewrite
    create-only), SIN oráculo de sha del ledger (outputSha256 ausente/vacío en clips-only = NORMAL). El
    `output` ya quedó acotado al prefijo autorizado por el llamador; aquí se fija la integridad real."""
    journal.record_adopting(authority, fence)
    try:
        imported = import_generated_video_once(
            output, ctx.token, session, expected_location=ctx.expected_location)
    except ProviderStorageImportUnknown:
        journal.record_unknown(authority, fence, reason='provider_import_unknown')
        return AdoptionOutcome('unknown', ('provider_import_unknown',))
    except ProviderStorageImportError:
        journal.record_failed(authority, fence, reason='provider_object_invalid')
        return AdoptionOutcome('failed', ('provider_object_invalid',))
    # F7 (import): require_private_bucket (storage_transport) lanza StorageTransportError (NO subclase de
    # ProviderStorageImportError; storage_import:65 ANTES del try interno) y los guards de input lanzan
    # ValueError crudo (storage_import:48/54/64) — ambos ESCAPABAN este try → crudo → UNCLASSIFIED ciego
    # (hueco REA, quemó 29e). Captúralos: StorageTransportError → record_unknown (incierto: mezcla
    # transitorio [red/5xx] y terminal [bucket config]; para storage_adopt provider_call=False, F6 lo
    # convierte en RE-ENCOLADO → recupera transitorios de un clip PAGADO, 0 cargo extra, acotado a
    # max_attempts→'failed'; recomendación REA, overridable por el dueño; F7.1 afinaría terminal→failed).
    # ValueError (input determinista: UUID/URI malformada) → record_failed (no se arregla reintentando).
    # Ambos LIMPIO+NOMBRADO (090-safe), no crudo. F7 NO garantiza la entrega; la hace limpia/nombrada.
    except StorageTransportError:
        journal.record_unknown(authority, fence, reason='import_bucket_unknown')
        return AdoptionOutcome('unknown', ('import_bucket_unknown',))
    except ValueError:
        journal.record_failed(authority, fence, reason='import_input_invalid')
        return AdoptionOutcome('failed', ('import_input_invalid',))

    # F7 (must-fix REA): provider_video_adoption_request lanza ValueError (asset_adoption:50/52/73:
    # owner_user_id/asset_id UUID inválido, o vídeo GCS importado no válido) y estaba SIN ENVOLVER entre
    # los dos try → escapaba → UNCLASSIFIED crudo. Determinista → record_failed LIMPIO+NOMBRADO.
    try:
        request = provider_video_adoption_request(
            imported, owner_user_id=authority.owner_user_id, asset_id=ctx.asset_id)
    except ValueError:
        journal.record_failed(authority, fence, reason='adoption_request_invalid')
        return AdoptionOutcome('failed', ('adoption_request_invalid',))
    try:
        result = adopt_provider_video_once(
            request, ctx.token, session, expected_location=ctx.expected_location)
    except ProviderAdoptionTransportConflict:
        # Destino canónico existente que NO coincide con el asset: no sobrescribir.
        journal.record_failed(authority, fence, reason='adoption_destination_conflict')
        return AdoptionOutcome('failed', ('adoption_destination_conflict',))
    except ProviderAdoptionTransportUnknown:
        journal.record_unknown(authority, fence, reason='adoption_unknown')
        return AdoptionOutcome('unknown', ('adoption_unknown',))
    except ProviderAdoptionTransportError as error:
        # F9(e): discriminador CARD-SAFE en el REASON del journal:
        # `adoption_rejected:http_<code>:<reason>[:<location>]` con `reason`=errors[0].reason (enum) y
        # `location`=errors[0].location (NOMBRE del campo inválido, p.ej. 'name'); fallback
        # 'unparseable' si GCS no dio JSON. NUNCA se mete el `message` de GCS (ecoa gs://+uuid) ni en
        # el ledger ni en log: `location` ya nombra el campo (veredicto unánime Consultor/REA/Interfaz).
        code = getattr(error, 'http_status', None)
        reason = getattr(error, 'gcs_reason', None)
        location = getattr(error, 'gcs_location', None)
        location_type = getattr(error, 'gcs_location_type', None)
        label = 'adoption_rejected'
        if isinstance(code, int):
            label += ':http_%d' % code
        label += ':' + (reason or 'unparseable')
        if location:
            label += ':' + location
            if location_type:  # 29j: data=body / parameter=query → desambigua el caso `name`
                label += ':' + location_type
        journal.record_failed(authority, fence, reason=label)
        return AdoptionOutcome('failed', (label,))
    # F7 (adopt): StorageTransportError de require_private_bucket (adoption_transport:110, bucket DESTINO
    # canónico — distinto del §6 que la generación ya verificó) → record_unknown (F6 → re-encolado:
    # recupera transitorios del clip PAGADO, 0 cargo extra, acotado). ValueError del guard de input (:108)
    # → record_failed (determinista). Ambos LIMPIO+NOMBRADO, no crudo→UNCLASSIFIED. NO garantiza entrega.
    except StorageTransportError:
        journal.record_unknown(authority, fence, reason='adoption_bucket_unknown')
        return AdoptionOutcome('unknown', ('adoption_bucket_unknown',))
    except ValueError:
        journal.record_failed(authority, fence, reason='adoption_input_invalid')
        return AdoptionOutcome('failed', ('adoption_input_invalid',))

    if isinstance(result, ProviderAdoptionRequest):
        # Rewrite no terminado en un POST: la continuación requiere otro claim.
        return AdoptionOutcome('adopting_continuation')
    if not isinstance(result, StorageReceipt):
        journal.record_unknown(authority, fence, reason='adoption_unverifiable')
        return AdoptionOutcome('unknown', ('adoption_unverifiable',))

    # 3) Éxito: 089 create-only vía el resolver (draft recién adoptado) + cierre del paso.
    journal.asset_draft_resolver = _draft_resolver(
        request, ctx.revision, ctx.owner_project_id)
    # F7.2: record_succeeded estaba FUERA de todo try → un ValueError del resolver (recibo↔draft) o un
    # EnvelopeJournalError (089/binding determinista) escapaban CRUDOS → UNCLASSIFIED ciego. Captúralos
    # LIMPIO+NOMBRADO. El rewrite GCS ya ocurrió y es idempotente (_reconcile 412 → recibo existente), así
    # que NO re-cobra ni re-POSTea. Errores psycopg/lease (CreativeLeaseLost) NO son de estas clases →
    # se relanzan (los maneja el heartbeat del runner), nunca se enmascaran.
    try:
        journal.record_succeeded(authority, fence, storage_receipts=(result,))
    except AdoptionRevisionConflict:
        # Fix entrega B: la revisión 089 ya existe (colisión de identidad). Terminal NOMBRADO
        # card-safe en lugar del PRE_POST_UNCLASSIFIED crudo que colgaba el attempt y quemaba el
        # cap. record_succeeded hizo rollback del INSERT y NO escribió terminal, así que este es el
        # ÚNICO mark_failed del attempt (sin choque con el trigger 090). Determinista → no reintentar.
        # DEBE ir antes del except genérico (es subclase de EnvelopeJournalError).
        journal.record_failed(authority, fence, reason='adoption_revision_conflict')
        return AdoptionOutcome('failed', ('adoption_revision_conflict',))
    except (ValueError, EnvelopeJournalError):
        journal.record_failed(authority, fence, reason='adoption_finalize_invalid')
        return AdoptionOutcome('failed', ('adoption_finalize_invalid',))
    return AdoptionOutcome('adopted', storage_receipt=result)


# 29j-B: ventana de render para el age-disambig de la recuperación por staging. ≥10 min desde el POST del
# padre (provider_started_at): dentro ⇒ el clip aún puede aparecer (pending; F9b-B re-conduce con backoff
# SIN consumir el cap); pasada y 0 objetos ⇒ terminal (nunca llegó o caducó), NUNCA un bucle.
_RENDER_WINDOW_SECONDS = 600


def adopt_from_staging(database, settings, claim: CreativeAttemptClaim, *,
                       context_loader: GoogleAdoptionContextLoader,
                       session: requests.Session, max_attempts: int = 3,
                       clock=None) -> AdoptionOutcome:
    """Recuperación por STAGING (NO por poll): para un clip YA generado+pagado cuyo LRO caducó (el objeto
    persiste en GCS aunque fetchPredictOperation ya no responda `done`). LISTA READ-ONLY el prefijo
    op-scoped PERSISTIDO del padre (ctx.expected_output_prefix) — NUNCA reconstruido/glob — y adopta el
    ÚNICO sample_0.mp4 por el MISMO camino endurecido que la adopción normal (_import_adopt_record): misma
    garantía (prefijo trusted + integridad auto-consistente del import), SIN oráculo de sha. 0 POST Veo, 0
    re-cargo. La ejecuta la interfaz re-conduciendo el storage_adopt re-encolado (requeue_failed_internal_
    step). STAGED + INERTE: sin handler vivo. Vuelve a Consultor + REA.

    age-disambig (0 objetos): dentro de la ventana de render (POST del padre + _RENDER_WINDOW_SECONDS) ⇒
    pending (el clip aún puede aparecer); pasada la ventana ⇒ record_failed TERMINAL
    'staging_absent_past_deadline' (NO un bucle). parent_provider_started_at None/naive (no acotable) ⇒
    conservador: pending."""
    if not isinstance(claim, CreativeAttemptClaim) or claim.kind != 'storage_adopt':
        raise ValueError('El claim no es un paso de adopción (storage_adopt).')
    now = (clock or (lambda: datetime.now(timezone.utc)))()
    # Mismo pre-list F7.3 que el pre-poll de run_google_adoption_once: context_loader.load (refresh OAuth
    # PATH A + rehidratación) fuera de todo try escaparía CRUDO → UNCLASSIFIED. Captúralo LIMPIO+NOMBRADO
    # con el propio claim. 0 POST (pre-list), money-safe. Inesperado (no estas clases) se RE-LANZA (F4).
    context_failure = None
    with database.connect() as c:
        try:
            authority, fence, ctx = context_loader.load(c, claim)
        except (CloudError, ClipsOnlyTokenError):
            context_failure = 'adoption_context_unknown'
        except ValueError:
            context_failure = 'adoption_context_invalid'
    if context_failure is not None:
        with database.connect() as c:
            mark_failed(c, assert_lease(c, claim), context_failure)
        return AdoptionOutcome('failed', (context_failure,))
    if not isinstance(ctx, AdoptionContext):
        raise ValueError('El contexto de adopción no es canónico.')
    journal = CreativeExecutionEnvelopeJournal(
        database, settings, kind='storage_adopt', max_attempts=max_attempts)

    # 1) LISTA READ-ONLY de EXACTAMENTE ctx.expected_output_prefix (prefijo trusted persistido; NO poll al
    # LRO caduco, NO reconstrucción, NO glob). Mapea cada final a la transición durable del journal.
    try:
        output = select_staged_video_output(
            ctx.expected_output_prefix, ctx.token, session,
            expected_location=ctx.expected_location)
    except StagingListUnknown:
        journal.record_unknown(authority, fence, reason='staging_list_unknown')
        return AdoptionOutcome('unknown', ('staging_list_unknown',))
    except StagingListAmbiguous:
        journal.record_failed(authority, fence, reason='staging_ambiguous')
        return AdoptionOutcome('failed', ('staging_ambiguous',))
    except StagingListInvalid:
        journal.record_failed(authority, fence, reason='staging_list_invalid')
        return AdoptionOutcome('failed', ('staging_list_invalid',))
    if output is None:
        # 0 objetos bajo el prefijo: age-disambig por ventana de render (NO poll, NO bucle).
        started = ctx.parent_provider_started_at
        if (started is not None and getattr(started, 'tzinfo', None) is not None
                and now >= started + timedelta(seconds=_RENDER_WINDOW_SECONDS)):
            journal.record_failed(
                authority, fence, reason='staging_absent_past_deadline')
            return AdoptionOutcome('failed', ('staging_absent_past_deadline',))
        return AdoptionOutcome('pending')

    # 2) Adoptar el único clip — MISMO camino endurecido que la adopción normal.
    return _import_adopt_record(journal, authority, fence, ctx, output, session)


def _draft_resolver(request: ProviderAdoptionRequest, revision: int,
                    owner_project_id: str | None):
    """Resolver 089 anclado a ESTA adopción: liga el recibo final a su draft exacto."""
    def resolve(_authority, _fence, receipt):
        expected = request.draft.expected
        if (not isinstance(receipt, StorageReceipt) or receipt.bucket != expected.bucket
                or receipt.name != expected.name or receipt.sha256 != expected.sha256):
            raise ValueError('El recibo adoptado no corresponde al draft de la adopción.')
        return request.draft, revision, owner_project_id
    return resolve


class GoogleAdoptionClaimHandler:
    """Forma handler (run/cancel) para el runner inactivo. NO se registra al arranque."""

    def __init__(self, database, settings, *,
                 context_loader: GoogleAdoptionContextLoader,
                 session_factory, max_attempts: int = 3) -> None:
        self.database = database
        self.settings = settings
        self.context_loader = context_loader
        self.session_factory = session_factory
        self.max_attempts = max_attempts

    def run(self, claim: CreativeAttemptClaim) -> AdoptionOutcome:
        session = self.session_factory()
        try:
            return run_google_adoption_once(
                self.database, self.settings, claim,
                context_loader=self.context_loader, session=session,
                max_attempts=self.max_attempts)
        finally:
            close = getattr(session, 'close', None)
            if callable(close):
                close()

    def cancel(self, claim: CreativeAttemptClaim) -> bool:
        # Ni la consulta ni el rewrite dejan efecto local cancelable; lo incierto lo
        # resuelve la recuperación durable, nunca un re-POST.
        return True


class GoogleStagingRecoveryClaimHandler:
    """Handler de RECUPERACIÓN por staging (run→adopt_from_staging): re-conduce la adopción de un clip YA
    generado+pagado cuyo LRO caducó, por el runner estándar (claim+lease+heartbeat). MISMA DI que
    GoogleAdoptionClaimHandler; NO se registra en el worker de despacho — solo en el entrypoint de
    recuperación, que además pasa allow_expired_admission=True al claim (bypass hermético). cancel = no-op
    seguro (ni list ni rewrite dejan efecto local cancelable; lo incierto lo resuelve la recuperación
    durable, nunca un re-POST). STAGED + INERTE: sin handler vivo. Vuelve a Consultor + REA."""

    def __init__(self, database, settings, *,
                 context_loader: GoogleAdoptionContextLoader,
                 session_factory, max_attempts: int = 3) -> None:
        self.database = database
        self.settings = settings
        self.context_loader = context_loader
        self.session_factory = session_factory
        self.max_attempts = max_attempts

    def run(self, claim: CreativeAttemptClaim) -> AdoptionOutcome:
        session = self.session_factory()
        try:
            return adopt_from_staging(
                self.database, self.settings, claim,
                context_loader=self.context_loader, session=session,
                max_attempts=self.max_attempts)
        finally:
            close = getattr(session, 'close', None)
            if callable(close):
                close()

    def cancel(self, claim: CreativeAttemptClaim) -> bool:
        return True
