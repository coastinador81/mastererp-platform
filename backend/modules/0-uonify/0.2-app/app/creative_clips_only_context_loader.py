"""context_loader clips-only (paso 4) — ensambla el `GoogleGenerationStepContext` para el despacho.

Implementa el Protocol `GoogleGenerationContextLoader.load(c, claim)` que consume
`run_google_generation_once`. La LECTURA de las filas persistidas (reconstruir authority+fence+request+
prefijo 129+preflight+allowlists para el claim) se delega a un `reader` INYECTADO: aísla el SQL/esquema
vivo (integración de interfaz/infra) y deja aquí SOLO la lógica Google que el Consultor verifica:

  1. `claim.kind == 'google_generation'` y `fence.attempt_id == claim.attempt_id` (el prefijo 129 que
     se usa es el del MISMO intento, condición del Consultor del paso 3).
  2. `bind_google_provider_request(request, bucket, authority, fence)` — valida que la petición usa su
     namespace durable exacto y que fingerprint(request)==authority.requestSha256 (sin bifurcar el cuerpo).
  3. `assert_bound_prefix_matches_persisted(binding, persisted_output_prefix)` — el prefijo derivado ==
     el persistido por reserve_once (129) para este intento.
  4. Cruce CUERPO↔LÍMITES (Q2 de W2): el cuerpo Veo (`parameters.durationSeconds`/`resolution`) DEBE
     coincidir con los límites aprobados (8 s/720p del binding); un cuerpo que no case se rechaza.
  5. TOKEN POR CLAIM (puerto 4, condición DURA del Consultor): `load()` acuña un token_provider cacheado
     FRESCO por claim vía `token_provider_factory()` (NO un singleton de arranque) y lo usa para el token de
     DESPACHO `token = token_provider(identity)` — PATH A (user-OAuth); el MISMO provider lo recibió el reader
     para el PREFLIGHT ⇒ UNA sola acuñación/refresh por claim. El `connection_loader` DENTRO del provider DEBE
     ser el validado de la voz (condición del Consultor; aquí se confía). interfaz inyecta la factory.
  6. Ensamblado del `GoogleGenerationStepContext` con el output_prefix confirmado.

STAGED + INERTE: sin red/DB propias (el `reader` inyectado las hace); sin registrarse en el worker. El
gate_decider (confirmación por generación) y el registro del handler son el cabling final, aparte.
Fail-closed: cualquier incoherencia ⇒ ValueError y 0 POST.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Protocol, runtime_checkable

from .creative_clips_only_binding import ClipLimits
from .creative_clips_only_dispatch_prefix import assert_bound_prefix_matches_persisted
from .creative_google_generation_authority import (GoogleGenerationAuthority,
                                                   GoogleGenerationFence)
from .creative_google_dispatch_codes import (BODY_LIMITS, CONTEXT_INVALID,
                                             PROVIDER_BINDING_MISMATCH)
from .creative_google_generation_caller import GoogleGenerationStepContext
from .creative_google_provider_request import bind_google_provider_request
from .creative_request_fingerprint import request_snapshot_json
from .creative_video_contracts import VideoRequest


class ClipsOnlyContextError(ValueError):
    """Fail-closed DETERMINISTA: el contexto clips-only no se pudo ensamblar de forma coherente.

    Extiende ValueError (no Exception) por condición del Consultor (paso 4): un fallo de load()
    (cuerpo↔límites, attempt/prefijo mismatch, token ausente, reader incoherente) es un rechazo
    DETERMINISTA, no un incierto → alinea con los ValueError de run_google_generation_once (:90/:94)
    para que el recover lo clasifique terminal y NO re-encole un fallo que volvería a fallar. La
    seguridad (0 POST: load() corre ANTES de cualquier POST) no cambia.

    F1: porta un `dispatch_code` estable (CONTEXT_INVALID por defecto; el llamador puede afinarlo, p.ej.
    BODY_LIMITS) para que el worker lo loguee sin exponer el mensaje (D-PROTECCIÓN)."""

    dispatch_code = CONTEXT_INVALID

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        if code is not None:
            self.dispatch_code = code


@dataclass(frozen=True)
class ClipsOnlyContextInputs:
    """Lo que el `reader` reconstruye de las filas persistidas del claim (SQL aislado del loader)."""
    authority: GoogleGenerationAuthority
    fence: GoogleGenerationFence
    request: VideoRequest
    bucket: str
    persisted_output_prefix: str      # de reserve_once (129), para claim.attempt_id
    approved_limits: ClipLimits        # 8 s/720p del binding aprobado
    catalog: object
    preflight: object
    preflight_receipt: object
    input_binding: object | None
    allowed_buckets: tuple[str, ...]
    allowed_output_buckets: tuple[str, ...]
    identity: object                   # para el token_provider (user-OAuth)


@runtime_checkable
class ClipsOnlyContextReader(Protocol):
    """Lee+reconstruye los inputs del claim desde la BD. Lo aporta la integración (interfaz/infra).

    Recibe el `token_provider` cacheado de ESTE claim (acuñado por el loader vía la factory) para el
    PREFLIGHT: la implementación construye un `ClipsOnlyLiveProvider` POR-CLAIM con ese mismo provider, de
    modo que el preflight y el token de despacho compartan UNA sola acuñación (condición puerto 4 del Consultor)."""

    def read(self, c, claim, token_provider, now) -> ClipsOnlyContextInputs:
        ...


def _assert_body_matches_limits(request: VideoRequest, limits: ClipLimits) -> None:
    """Q2 (W2): el cuerpo Veo debe reflejar EXACTAMENTE los límites que el cliente aprobó."""
    params = request.body.get('parameters') if isinstance(request.body, dict) else None
    if not isinstance(params, dict):
        raise ClipsOnlyContextError('El cuerpo Veo no trae parameters.')
    if (params.get('durationSeconds') != limits.duration_seconds
            or params.get('resolution') != limits.resolution):
        raise ClipsOnlyContextError(
            'El cuerpo Veo no coincide con los límites aprobados (duración/resolución).',
            code=BODY_LIMITS)


class ClipsOnlyContextLoader:
    """`GoogleGenerationContextLoader` concreto para clips-only. Reader + token_provider inyectados."""

    def __init__(self, *, reader: ClipsOnlyContextReader,
                 token_provider_factory: Callable[[], Callable[[object], str]]) -> None:
        if (not callable(getattr(reader, 'read', None))
                or not callable(token_provider_factory)):
            raise ClipsOnlyContextError('reader y token_provider_factory deben ser invocables.')
        self._reader = reader
        self._token_provider_factory = token_provider_factory

    def load(self, c, claim, now) -> tuple[GoogleGenerationAuthority, GoogleGenerationFence,
                                           GoogleGenerationStepContext]:
        if getattr(claim, 'kind', None) != 'google_generation':
            raise ClipsOnlyContextError('El claim no es una generación Google.')
        # TOKEN POR CLAIM (puerto 4, condición DURA del Consultor): load() corre UNA vez por claim, así que
        # aquí se acuña un token_provider cacheado FRESCO para ESTE claim (NO un singleton de arranque). El
        # MISMO provider va al reader (preflight, vía un ClipsOnlyLiveProvider por-claim) y al token de
        # despacho (abajo) ⇒ UNA sola acuñación/refresh por claim (el TTL cubre preflight→despacho).
        token_provider = self._token_provider_factory()
        if not callable(token_provider):
            raise ClipsOnlyContextError('El token_provider_factory no devolvió un proveedor invocable.')
        # SINGLE-NOW (A): se reenvía el `now`=T0 del worker al reader → live_provider.resolve, donde se acuña
        # el preflight. El TTL (10 min) cubre preflight→despacho con el MISMO reloj (no el del reader).
        inputs = self._reader.read(c, claim, token_provider, now)
        if not isinstance(inputs, ClipsOnlyContextInputs):
            raise ClipsOnlyContextError('El reader no devolvió inputs canónicos.')
        if not isinstance(inputs.request, VideoRequest):
            raise ClipsOnlyContextError('La petición reconstruida no es un VideoRequest.')
        # (1) el prefijo que usaremos es el del MISMO intento del claim (condición Consultor paso 3).
        if inputs.fence.attempt_id != getattr(claim, 'attempt_id', None):
            raise ClipsOnlyContextError('El fence no corresponde al intento del claim.')
        # (2) bind_google valida namespace durable + model + requestSha256==authority (sin bifurcar).
        # F1-ext: su ValueError plano (namespace/fingerprint) → PROVIDER_BINDING_MISMATCH (antes UNCLASSIFIED).
        try:
            binding = bind_google_provider_request(
                inputs.request, inputs.bucket, inputs.authority, inputs.fence)
        except ValueError as error:
            raise ClipsOnlyContextError(
                'La petición reconstruida no casa su binding durable (namespace/fingerprint).',
                code=PROVIDER_BINDING_MISMATCH) from error
        # (3) prefijo derivado == persistido (129) para este intento.
        output_prefix = assert_bound_prefix_matches_persisted(
            binding, inputs.persisted_output_prefix)
        # (4) cuerpo Veo ↔ límites aprobados (8 s/720p).
        _assert_body_matches_limits(inputs.request, inputs.approved_limits)
        # (5) token PATH A (user-OAuth) de DESPACHO con el MISMO provider por-claim (cache hit tras el
        # preflight ⇒ sin segunda acuñación). connection_loader validado dentro del provider.
        token = token_provider(inputs.identity)
        if not isinstance(token, str) or not token:
            raise ClipsOnlyContextError('El token_provider no devolvió un Bearer válido.')
        # (6) ensamblado; request_sha256 = authority (bind_google ya lo ató a fingerprint(request)).
        ctx = GoogleGenerationStepContext(
            request_snapshot_json=request_snapshot_json(inputs.request),
            request_sha256=inputs.authority.request_sha256,
            catalog=inputs.catalog, preflight=inputs.preflight,
            preflight_receipt=inputs.preflight_receipt,
            request_operation_id=inputs.authority.operation_id, token=token,
            input_binding=inputs.input_binding,
            allowed_buckets=inputs.allowed_buckets, output_prefix=output_prefix,
            allowed_output_buckets=inputs.allowed_output_buckets)
        return inputs.authority, inputs.fence, ctx
