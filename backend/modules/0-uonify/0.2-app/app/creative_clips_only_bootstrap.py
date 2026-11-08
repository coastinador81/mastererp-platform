"""Bootstrap INERTE del cableado vivo clips-only (cabling de interfaz, paso go-live). STAGED.

CONSTRUYE los 2 handlers REALES + los helpers de conexión/token por-claim para el piloto clips-only del
Estudio (vía `build_clips_only_real_handlers`). La ENSAMBLADURA del registry (dict de los 5
CREATIVE_STEP_KINDS + 3 stubs fail-closed + belt C-WRK-1) la hace
`creative_clips_only_worker_bootstrap.build_clips_only_handlers` (Consultor §8.12 + REA), a la que se
INYECTAN estos 2 reales:
- google_generation: `GoogleGenerationClaimHandler` con
  `ClipsOnlyContextLoader` → `ClipsOnlyReader`(9f64c0d) → `ClipsOnlyLiveProvider` POR-CLAIM
  (token PATH A por-claim; gate de gasto client_explicit).
- storage_adopt: `GoogleAdoptionClaimHandler` con `ClipsOnlyAdoptionLoader` (token por-claim; sin gasto
  nuevo — poll+import+adopt del clip ya generado).
- craft / candidate_adopt / review: STUBS fail-closed. El grafo clips-only solo emite
  google_generation→storage_adopt y el runner excluye 'craft'; estos kinds nunca se reclaman. Si alguno
  se reclamara, el stub raisea en vez de actuar (fail-closed).

INERTE / GATEADO (no se relaja aquí): este módulo NO se importa en el arranque, NO monta ninguna ruta y
NO arranca ningún worker. El despacho real sigue cerrado por tres puertas independientes, todas aguas
abajo y ya revisadas: (a) el `gate_decider` (confirmación client_explicit, vigente, match exacto), (b) el
flag maestro `PRODUCTION_GOOGLE_DISPATCH_ENABLED` (False; lo flipea el dueño en el release), (c) el WIF de
producción. La ACTIVACIÓN —arrancar un worker que llame `run_clips_only_worker_once` en bucle +
`recover_and_reconcile_expired` periódico, y montar la ruta de subida en main— es el paso go-live,
owner-gated, fuera de este módulo.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import requests
from cryptography.fernet import Fernet

from .creative_clips_only_adoption_loader import ClipsOnlyAdoptionLoader
from .creative_clips_only_confirmation import StoredGenerationConfirmationLookup
from .creative_clips_only_confirmation_store import generation_confirmation_fetch
from .creative_clips_only_context_loader import ClipsOnlyContextLoader
from .creative_clips_only_execution_loader import clips_only_execution_loader
from .creative_clips_only_gate import clips_only_gate_decider
from .creative_clips_only_live_provider import (ClipsOnlyLiveProvider,
    clips_only_cached_token_provider)
from .creative_clips_only_owned_input import clips_only_resolve_input_receipts
from .creative_clips_only_reader import ClipsOnlyReader
from .creative_clips_only_token_provider import clips_only_token_provider
from .creative_google_adoption_runner import GoogleAdoptionClaimHandler
from .creative_google_generation_caller import GoogleGenerationClaimHandler
from .google_cloud_provider import SCOPE, GoogleCloudProvider


class ClipsOnlyBootstrapError(RuntimeError):
    """El cableado clips-only no se pudo ensamblar/activar de forma coherente (fail-closed)."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def make_connection_loader(database):
    """`connection_loader(identity) -> row`, validado COMO LA VOZ (mismo patrón que `_connection_row` de
    la ruta de subida, creative_clips_only_upload_route.py:46): abre su PROPIA conexión corta y exige una
    conexión Google Cloud del cliente vigente (google_subject del claim, status 'connected',
    project_check.ready, SCOPE cloud-platform presente). Fail-closed. El token_provider usa
    `row['refresh_encrypted']`. La identidad viene del claim (user del claim, NUNCA del cuerpo)."""
    def connection_loader(identity):
        user_id = getattr(identity, 'user_id', None)
        google_subject = getattr(identity, 'google_subject', None)
        if not user_id or not google_subject:
            raise ClipsOnlyBootstrapError('La identidad del claim no es válida.')
        with database.connect() as c:
            row = c.execute(
                '''SELECT google_subject,project_id,status,project_check,refresh_encrypted,scope
                   FROM google_cloud_connections WHERE user_id=%s''',
                (user_id,)).fetchone()
        checks = row.get('project_check') if row else None
        if (not row or row['google_subject'] != google_subject
                or row['status'] != 'connected' or not isinstance(checks, dict)
                or checks.get('ready') is not True
                or SCOPE not in (row.get('scope') or '').split()):
            raise ClipsOnlyBootstrapError('La conexión Google Cloud del cliente no está vigente.')
        return row
    return connection_loader


def make_token_provider_factory(database, settings, cloud):
    """Factory token PATH A POR-CLAIM:
    `() -> clips_only_cached_token_provider(clips_only_token_provider(connection_loader, cipher, cloud))`.
    El inner es EXACTAMENTE `clips_only_token_provider` (invariante anti-CRLF de REA; no envolver ni
    sustituir). Devuelve un provider cacheado FRESCO por claim (una acuñación/refresh por claim,
    compartida entre preflight y despacho)."""
    connection_loader = make_connection_loader(database)
    cipher = Fernet(settings.encryption_key)

    def factory():
        return clips_only_cached_token_provider(
            clips_only_token_provider(
                connection_loader=connection_loader, cipher=cipher, cloud=cloud))
    return factory


def build_clips_only_real_handlers(database, settings, cloud=None, *,
                                   clock=_utc_now,
                                   gate_max_age: timedelta = timedelta(hours=1)):
    """Construye SOLO los 2 handlers REALES del piloto clips-only (google_generation + storage_adopt) con su
    DI por-claim. NO ensambla el registry ni añade stubs: la ENSAMBLADURA canónica (dict de los 5 kinds + 3
    stubs fail-closed + belt C-WRK-1) la hace `build_clips_only_handlers` de
    `creative_clips_only_worker_bootstrap` (aprobada Consultor §8.12 + REA), a la que se le INYECTAN estos 2.
    INERTE: construir NO despacha; el despacho lo cierran gate_decider + PRODUCTION_GOOGLE_DISPATCH_ENABLED +
    WIF (aguas abajo). Devuelve (google_generation, storage_adopt)."""
    cloud = cloud or GoogleCloudProvider(settings)
    factory = make_token_provider_factory(database, settings, cloud)

    def live_provider_factory(token_provider):
        return ClipsOnlyLiveProvider(
            token_provider=token_provider,
            session_factory=lambda: requests.Session(),
            clock=clock, settings=settings,
            execution_loader=clips_only_execution_loader,
            input_receipt_resolver=clips_only_resolve_input_receipts)

    reader = ClipsOnlyReader(live_provider_factory=live_provider_factory)
    generation_context = ClipsOnlyContextLoader(
        reader=reader, token_provider_factory=factory)
    gate_decider = clips_only_gate_decider(
        StoredGenerationConfirmationLookup(generation_confirmation_fetch(database)),
        max_age=gate_max_age)

    google_generation = GoogleGenerationClaimHandler(
        database, settings, context_loader=generation_context,
        session_factory=lambda: requests.Session(), clock=clock,
        gate_decider=gate_decider)
    storage_adopt = GoogleAdoptionClaimHandler(
        database, settings,
        context_loader=ClipsOnlyAdoptionLoader(token_provider_factory=factory),
        session_factory=lambda: requests.Session(),
        # F9(d): tope POR-KIND del _retry de adopción (provider_call=false, 0 cargo Veo) a 10 → da
        # margen al re-poll de un LRO en curso / re-encolado de un transitorio sin agotar en 3. NO se
        # toca el max_claims GLOBAL de recover_and_reconcile_expired (afecta a google_generation =
        # backstop de GASTO: cada re-claim pre-POST puede POSTear). La generación conserva su tope bajo.
        max_attempts=10)
    return google_generation, storage_adopt


def run_clips_only_worker_once(database, settings, worker_id: str, *,
                               cloud=None, job_id: UUID | None = None):
    """ARRANQUE INERTE (go-live, owner-gated): una sola reclamación con los 5 handlers. NO se llama en
    import ni en el arranque del proceso. Defensa en profundidad: rehúsa si el flag maestro sigue cerrado
    (el despacho real también lo cierra el dispatch gate aguas abajo). La activación de producción monta
    esto en un bucle de worker (modelo ConversationWorker) + recover_and_reconcile_expired periódico."""
    from .creative_google_dispatch_gate import PRODUCTION_GOOGLE_DISPATCH_ENABLED
    if PRODUCTION_GOOGLE_DISPATCH_ENABLED is not True:
        raise ClipsOnlyBootstrapError(
            'Despacho de producción cerrado (PRODUCTION_GOOGLE_DISPATCH_ENABLED=False).')
    from .creative_clips_only_worker_bootstrap import build_clips_only_handlers
    from .creative_execution_runner import claim_and_run_one
    gen, adopt = build_clips_only_real_handlers(database, settings, cloud)
    handlers = build_clips_only_handlers(
        google_generation_handler=gen, storage_adopt_handler=adopt)
    return claim_and_run_one(database, settings, worker_id, handlers, job_id=job_id)
