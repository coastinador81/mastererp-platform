"""Reader real del context_loader clips-only (ítem 4, build ronda 1; resolución del Consultor 27-10).

Implementa `ClipsOnlyContextReader.read(c, claim) -> ClipsOnlyContextInputs` reconstruyendo del MUNDO
090 (grafo) todo lo necesario para despachar un intento de generación Veo, keyed por el claim
(user_id, job_id, step_id, attempt_id). Reusa:
  * `load_google_claim_context` → el VideoRequest reconstruido+verificado (vía google_request_from_snapshot)
    + operation_id + request_sha256 (y sus chequeos de claim/step).
  * `rehydrate_admitted_execution` → approval_id, quote_id, execution_graph_sha256 (recibos durables).
La PARTE PURA (`_assemble_inputs`) arma authority(16)/fence/limits/output_prefix/google_location desde
filas ya leídas → testeable sin DB. Las piezas VIVAS (catalog/preflight/preflight_receipt acuñados en
red, bucket de la conexión Cloud del cliente con el invariante 119, input_binding del recibo GCS del
fotograma, allowlists, identity) las aporta un `live_provider` INYECTADO = CABLING (vuelve al Consultor
con la credencial). El prefijo §6 sale de creative_execution_attempts.output_prefix (migración 134,
persistido en el claim); si es NULL → fail-closed (intento sin prefijo reservado).

Fail-closed: cualquier incoherencia ⇒ ValueError (clasificación terminal, como ClipsOnlyContextError).
STAGED + INERTE: sin red propia; el live_provider y el cableado vuelven al Consultor + REA antes de vivo.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Protocol, runtime_checkable
from uuid import UUID

from .creative_clips_only_binding import ClipLimits, clip_limits
from .creative_clips_only_context_loader import ClipsOnlyContextInputs
from .creative_google_claim_context import load_google_claim_context
from .creative_google_dispatch_codes import (CLAIM_CONTEXT_INVALID,
                                             CLIPS_ONLY_DISPATCH_CODES,
                                             READER_INVALID)
from .creative_google_generation_authority import (GoogleGenerationAuthority,
                                                   GoogleGenerationFence)

# Región Veo del prefijo/bucket (co-ubicación, condición del Consultor). google_location se DERIVA del
# endpoint reconstruido y se valida == us-central1 (no es parámetro libre).
_VEO_LOCATION = 'us-central1'
_ENDPOINT_LOCATION = re.compile(r'/locations/([^/]+)/')


class ClipsOnlyReaderError(ValueError):
    """Fail-closed DETERMINISTA del reader clips-only (alinea con ValueError → recover terminal).

    F1: porta dispatch_code (READER_INVALID por defecto; el llamador lo afina, p.ej. CLAIM_CONTEXT_INVALID)
    para el log del worker sin exponer el mensaje."""

    dispatch_code = READER_INVALID

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        if code is not None:
            self.dispatch_code = code


@dataclass(frozen=True)
class ClipsOnlyLiveParts:
    """Piezas VIVAS del contexto (red/credencial/conexión Cloud) que aporta el cabling, no la BD."""
    catalog: object
    preflight: object
    preflight_receipt: object
    input_binding: object | None
    output_bucket: str
    allowed_buckets: tuple[str, ...]
    allowed_output_buckets: tuple[str, ...]
    identity: object


@runtime_checkable
class ClipsOnlyLiveProvider(Protocol):
    """Aporta las piezas vivas para el claim+request (cabling: preflight en vivo, bucket de la conexión
    Cloud con el invariante 119, input_binding del fotograma). Vuelve al Consultor con la credencial."""

    def resolve(self, c, claim, request, *, google_project: str, now) -> ClipsOnlyLiveParts:
        ...


def _location_from_endpoint(endpoint: str) -> str:
    match = _ENDPOINT_LOCATION.search(endpoint) if isinstance(endpoint, str) else None
    location = match.group(1) if match else None
    if location != _VEO_LOCATION:
        raise ClipsOnlyReaderError('La región del endpoint Veo no es us-central1.')
    return location


def _limits_from_snapshot(snapshot: object) -> ClipLimits:
    if not isinstance(snapshot, dict):
        raise ClipsOnlyReaderError('El snapshot de límites no es válido.')
    duration = snapshot.get('maxDurationSeconds')
    resolution = snapshot.get('resolution')
    try:
        # clip_limits RE-VALIDA el allowset (8 s/720p); un snapshot fuera de allowset falla cerrado.
        return clip_limits(duration, resolution)
    except Exception as error:
        raise ClipsOnlyReaderError('Los límites persistidos no son admisibles.') from error


def _assemble_inputs(claim, *, request, operation_id: str, request_sha256: str,
                     approval_id: str, execution_graph_sha256: str,
                     quote_row: dict, attempt_row: dict,
                     live: ClipsOnlyLiveParts) -> ClipsOnlyContextInputs:
    """PURA (testeable sin DB): arma ClipsOnlyContextInputs desde filas/valores ya leídos. Fail-closed."""
    if not isinstance(quote_row, dict) or not isinstance(attempt_row, dict):
        raise ClipsOnlyReaderError('Filas de cotización/intento no válidas.')
    if not isinstance(live, ClipsOnlyLiveParts):
        raise ClipsOnlyReaderError('Las piezas vivas no son válidas.')
    output_prefix = attempt_row.get('output_prefix')
    if not isinstance(output_prefix, str) or not output_prefix:
        # El prefijo §6 lo persiste el claim (migración 134 + paso reserva-y-persiste); si falta, el
        # intento no reservó salida → no se puede despachar.
        raise ClipsOnlyReaderError('El intento no tiene output_prefix reservado (§6).')
    if str(attempt_row.get('id')) != claim.attempt_id:
        raise ClipsOnlyReaderError('La fila del intento no corresponde al claim.')
    authority = GoogleGenerationAuthority(
        owner_user_id=claim.user_id, uonify_project_id=quote_row.get('uonify_project_id'),
        google_project=quote_row.get('google_project_id'),
        google_location=_location_from_endpoint(request.endpoint),
        model=request.model, job_id=claim.job_id, source_step_id=claim.step_id,
        operation_id=operation_id, request_sha256=request_sha256, approval_id=approval_id,
        quote_sha256=quote_row.get('quote_sha256'),
        binding_sha256=quote_row.get('binding_sha256'),
        costs_snapshot_sha256=quote_row.get('costs_snapshot_sha256'),
        admission_sha256=claim.admission_sha256, claim_set_sha256=claim.claim_set_sha256,
        execution_graph_sha256=execution_graph_sha256)
    fence = GoogleGenerationFence(
        attempt_id=claim.attempt_id, attempt_no=attempt_row.get('attempt_no'),
        claim_lease_token=str(attempt_row.get('claim_lease_token')),
        fence_epoch=attempt_row.get('fence_epoch'))
    return ClipsOnlyContextInputs(
        authority, fence, request, live.output_bucket, output_prefix,
        _limits_from_snapshot(quote_row.get('limits_snapshot')),
        live.catalog, live.preflight, live.preflight_receipt, live.input_binding,
        live.allowed_buckets, live.allowed_output_buckets, live.identity)


class ClipsOnlyReader:
    """`ClipsOnlyContextReader` concreto. `live_provider_factory(token_provider)` inyectado = cabling:
    construye un `ClipsOnlyLiveProvider` POR-CLAIM con el token_provider de ESTE claim (puerto 4, token-por-
    claim). Así el preflight (aquí) y el despacho (context_loader) comparten UNA sola acuñación. El factory lo
    aporta interfaz cerrando sobre session_factory/clock/settings/execution_loader/input_receipt_resolver."""

    def __init__(self, *, live_provider_factory: Callable[[object], ClipsOnlyLiveProvider]) -> None:
        if not callable(live_provider_factory):
            raise ClipsOnlyReaderError('live_provider_factory no es válido.')
        self._live_provider_factory = live_provider_factory

    def read(self, c, claim, token_provider, now) -> ClipsOnlyContextInputs:
        if getattr(claim, 'kind', None) != 'google_generation':
            raise ClipsOnlyReaderError('El claim no es una generación Google.')
        if not callable(token_provider):
            raise ClipsOnlyReaderError('token_provider inválido para el reader (token-por-claim).')
        # token-por-claim: construye el ClipsOnlyLiveProvider de ESTE claim con el token_provider que llega
        # (acuñación única compartida preflight+despacho). Fail-closed si el factory no devuelve un provider.
        live_provider = self._live_provider_factory(token_provider)
        if not callable(getattr(live_provider, 'resolve', None)):
            raise ClipsOnlyReaderError('El live_provider_factory no devolvió un provider válido.')
        # Request reconstruido+verificado + operation_id + request_sha256 (reusa el loader verificado).
        # F1-ext: un fallo DETERMINISTA (ValueError) de la reconstrucción/verificación → CLAIM_CONTEXT_INVALID
        # (antes caía a PRE_POST_UNCLASSIFIED). Sigue pre-POST → 0 cargo. (ClipsOnlyReaderError ya lleva código.)
        try:
            gctx = load_google_claim_context(c, claim)
        except ClipsOnlyReaderError:
            raise
        except ValueError as error:
            # F2b-split: PRESERVA el código fino que porte load_google_claim_context (CLAIM_STATE/REHYDRATE/
            # CLAIM_VERIFY); si es un ValueError sin código, cae al genérico CLAIM_CONTEXT_INVALID.
            inner = getattr(error, 'dispatch_code', None)
            raise ClipsOnlyReaderError(
                'No se pudo reconstruir/verificar el contexto del claim.',
                code=inner if isinstance(inner, str) and inner in CLIPS_ONLY_DISPATCH_CODES
                else CLAIM_CONTEXT_INVALID) from error
        owner = c.execute('SELECT * FROM users WHERE id=%s FOR SHARE',
                          (claim.user_id,)).fetchone()
        if not owner:
            raise ClipsOnlyReaderError('La identidad propietaria no está vigente.')
        from .creative_execution_rehydration import rehydrate_admitted_execution
        restored = rehydrate_admitted_execution(c, owner, UUID(claim.job_id), lock_reads=True)
        quote_row = c.execute(
            '''SELECT id,google_project_id,uonify_project_id,quote_sha256,binding_sha256,
               costs_snapshot_sha256,limits_snapshot FROM creative_execution_quotes
               WHERE user_id=%s AND id=%s FOR SHARE''',
            (claim.user_id, restored.quote_id)).fetchone()
        attempt_row = c.execute(
            '''SELECT id,attempt_no,claim_lease_token,fence_epoch,output_prefix
               FROM creative_execution_attempts WHERE user_id=%s AND id=%s FOR SHARE''',
            (claim.user_id, claim.attempt_id)).fetchone()
        if not quote_row or not attempt_row:
            raise ClipsOnlyReaderError('Faltan filas durables de cotización/intento.')
        live = live_provider.resolve(c, claim, gctx.request,
                                     google_project=quote_row.get('google_project_id'), now=now)
        return _assemble_inputs(
            claim, request=gctx.request, operation_id=gctx.operation_id,
            request_sha256=gctx.request_sha256, approval_id=restored.approval_id,
            execution_graph_sha256=restored.execution_graph_sha256,
            quote_row=dict(quote_row), attempt_row=dict(attempt_row), live=live)
