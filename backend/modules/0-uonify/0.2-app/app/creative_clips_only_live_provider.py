"""`ClipsOnlyLiveProvider` concreto (PARTE 2): arma las piezas VIVAS del despacho Veo clips-only.

Implementa `ClipsOnlyLiveProvider.resolve(c, claim, request, *, google_project) -> ClipsOnlyLiveParts`
(creative_clips_only_reader): catalog, preflight, preflight_receipt, input_binding, output_bucket,
allowed_buckets, allowed_output_buckets, identity. Construido contra CAPA 2 (mi copia == snap-rc2 + §E-§H
aprobado); el MANIFIESTO SHA prueba base==snap-rc2 y §E-§H==aprobado.

RULINGS DEL CONSULTOR (aplicados, incl. la ADJUDICACIÓN de los 4 puertos):
  * CATÁLOGO: IMPORTA las constantes de evidencia de creative_google_capabilities (AUDITED_PROJECT +
    AUDIT/REFERENCE/SERVICE_CHECKS_SHA256) — NO las hardcodea; en CAPA 2 = la capabilities §E-§H (d041978d),
    que el Consultor re-confirma. google_creative_catalog valida project==AUDITED_PROJECT (gate A backstop).
  * 119: validate_active_execution_scope (familia creativa: cloud.project_id==plan.project_id + connected +
    ready + billing='enabled' + google_subject). Lee google_cloud_connections en la MISMA txn `c` (FOR SHARE).
  * PUERTO 4 (token) = CACHEADO: se inyecta UN `token_provider` cacheado por-claim (PATH A, vía voz), y el
    live_provider lo usa para el preflight; el MISMO token_provider cacheado se inyecta al context_loader para el
    DESPACHO ⇒ UNA sola acuñación/refresh por claim (el TTL cubre preflight→despacho). `clips_only_cached_token_provider`
    envuelve el provider base (clips_only_token_provider) y memoiza por identity.
  * NO toca PRODUCTION_GOOGLE_DISPATCH_ENABLED (flag maestro) — lo flipea el dueño en el release.
  * input_binding = bind_google_owned_inputs(request, owner_id, receipts); recibo VERIFICADO (uri+generation+
    sha256) del objeto GCS real; texto -> None.

PUERTOS INYECTADOS (adjudicados por el Consultor; su wiring/registro es cabling de infra + ArtCraft):
  * token_provider: el cacheado (puerto 4), compartido con el context_loader.
  * execution_loader(c, owner, claim) -> dict{planId, planRevision, ...} (PUERTO 3 OK): de
    creative_execution_quotes.quote_snapshot['execution'] del quote del job del claim (durable, bound por
    quote_sha256); verifica que es el quote del job del claim. Adaptador de lectura, sin red.
  * input_receipt_resolver(c, owner, claim, request) -> tuple[StorageReceipt] (PUERTO 2 OK): resuelve el asset de
    entrada por asset_id + revisión EXACTA del plan (authorization_state='allowed', anti-swap) → StorageReceipt
    verificado; simétrico al asset_recorder del uploader (MISMA store de la biblioteca de assets).
  * PUERTO 1 (asset_recorder del uploader) NO es source_job_id sintético: procedencia 'uploaded' en la biblioteca
    de assets de ArtCraft (§B/§C, 089) — coordinación con ArtCraft/interfaz; la migración (source_job_id NULLABLE +
    campo procedencia, o tabla aparte) vuelve al Consultor + REA. El input_receipt_resolver lee de ESA store.

STAGED + INERTE: puro sobre puertos inyectados; sin red/DB propias; sin handler registrado (lo cabla interfaz).
Fail-closed ⇒ ClipsOnlyLiveProviderError(ValueError).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import requests

from .creative_clips_only_bucket import clips_only_output_bucket
from .creative_clips_only_reader import ClipsOnlyLiveParts
from .creative_google_dispatch_codes import (CLIPS_ONLY_DISPATCH_CODES,
                                            FIRSTFRAME_NOT_OWNED,
                                            INPUT_NOT_OWNED, LIVE_PROVIDER,
                                            PREFLIGHT_INVALID, SCOPE_MISMATCH)
from .creative_google_capabilities import (AUDIT_RESULTS_SHA256,
                                           AUDITED_PROJECT,
                                           REFERENCE_RESULTS_SHA256,
                                           SERVICE_CHECKS_SHA256,
                                           google_creative_catalog)
from .creative_google_input_ownership import bind_google_owned_inputs
from .creative_google_preflight import creative_google_preflight
from .creative_google_preflight_client import GoogleCreativeHttpClient
from .creative_google_preflight_receipt import google_preflight_receipt

_REQUIRED_SERVICES = ("aiplatform.googleapis.com", "storage.googleapis.com")


class ClipsOnlyLiveProviderError(ValueError):
    """Fail-closed DETERMINISTA: no se pudieron armar las piezas vivas del despacho clips-only.

    F1: porta un `dispatch_code` estable (LIVE_PROVIDER por defecto; afinado por el llamador, p.ej.
    SCOPE_MISMATCH / FIRSTFRAME_NOT_OWNED / INPUT_NOT_OWNED) para el log del worker sin exponer el mensaje."""

    dispatch_code = LIVE_PROVIDER

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        if code is not None:
            self.dispatch_code = code


def _is_first_frame_request(request) -> bool:
    """§H: ¿el cuerpo Veo usa la forma PRIMER FOTOGRAMA `instances[0].image.gcsUri`? (por FORMA, no mensaje)."""
    body = getattr(request, 'body', None)
    instances = body.get('instances') if isinstance(body, dict) else None
    instance = instances[0] if isinstance(instances, list) and instances else None
    image = instance.get('image') if isinstance(instance, dict) else None
    return isinstance(image, dict) and 'gcsUri' in image


@dataclass(frozen=True)
class ClipsOnlyIdentity:
    """Identidad para el token_provider/connection_loader (user del claim, NUNCA del cuerpo)."""
    user_id: str
    google_subject: str
    project_id: str


def clips_only_cached_token_provider(inner: Callable[[object], str]) -> Callable[[object], str]:
    """PUERTO 4: memoiza el token PATH A por `identity` ⇒ UNA acuñación por claim, reutilizada por el
    preflight (live_provider) y el despacho (context_loader). El worker crea UNO por claim e inyecta el MISMO
    a ambos. Fail-closed: si el inner no devuelve un Bearer válido, no cachea (reintenta en la próxima llamada)."""
    if not callable(inner):
        raise ClipsOnlyLiveProviderError("token_provider base no es invocable.")
    cache: dict[tuple, str] = {}

    def provide(identity: object) -> str:
        key = (getattr(identity, "user_id", None), getattr(identity, "project_id", None))
        token = cache.get(key)
        if token:
            return token
        token = inner(identity)
        if isinstance(token, str) and token and "\r" not in token and "\n" not in token:
            cache[key] = token
        return token

    return provide


class ClipsOnlyLiveProvider:
    """`ClipsOnlyLiveProvider` concreto. token_provider (cacheado) + adaptadores de lectura inyectados = cabling."""

    def __init__(self, *, token_provider: Callable[[object], str],
                 session_factory: Callable[[], requests.Session],
                 clock: Callable[[], object], settings: object,
                 execution_loader: Callable[..., dict],
                 input_receipt_resolver: Callable[..., tuple]) -> None:
        for name, fn in (("token_provider", token_provider), ("session_factory", session_factory),
                         ("clock", clock), ("execution_loader", execution_loader),
                         ("input_receipt_resolver", input_receipt_resolver)):
            if not callable(fn):
                raise ClipsOnlyLiveProviderError(f"{name} inyectado no es válido.")
        self._token_provider = token_provider
        self._session_factory = session_factory
        self._clock = clock
        self._settings = settings
        self._execution_loader = execution_loader
        self._input_receipt_resolver = input_receipt_resolver

    def resolve(self, c, claim, request, *, google_project: str, now) -> ClipsOnlyLiveParts:
        if getattr(claim, "kind", None) != "google_generation":
            raise ClipsOnlyLiveProviderError("El claim no es una generación Google.")
        owner = c.execute("SELECT * FROM users WHERE id=%s FOR SHARE",
                          (claim.user_id,)).fetchone()
        if not owner or not owner.get("google_subject"):
            raise ClipsOnlyLiveProviderError("La identidad propietaria no está vigente.")
        # 119 (proyecto/conexión) con el validador de la familia creativa; misma txn `c` (FOR SHARE).
        execution = self._execution_loader(c, owner, claim)  # ClipsOnlyExecutionLoaderError → EXECUTION_LOADER_INVALID
        from .creative_execution_ledger import validate_active_execution_scope
        # F1-ext: un fallo DETERMINISTA del 119 (ValueError) → SCOPE_MISMATCH (antes PRE_POST_UNCLASSIFIED).
        try:
            validated_owner, plan = validate_active_execution_scope(c, owner, execution)
        except ValueError as error:
            raise ClipsOnlyLiveProviderError(
                "El scope de ejecución (119) no valida.", code=SCOPE_MISMATCH) from error
        if (plan.get("project_id") != google_project
                or str(validated_owner.get("id")) != claim.user_id):
            raise ClipsOnlyLiveProviderError(
                "El proyecto pagador no coincide con la cotización (119).", code=SCOPE_MISMATCH)
        identity = ClipsOnlyIdentity(
            user_id=claim.user_id, google_subject=owner["google_subject"],
            project_id=google_project)
        # Token PATH A CACHEADO (puerto 4): una acuñación por claim, compartida con el despacho.
        token = self._token_provider(identity)
        if not isinstance(token, str) or not token:
            raise ClipsOnlyLiveProviderError("El token_provider no devolvió un Bearer válido.")
        # SINGLE-NOW (A): se usa el `now`=T0 que LLEGA del worker (threaded caller→context_loader→reader), NO
        # self._clock(). El preflight se ACUÑA (checked_at=T0) con el MISMO instante con que el gate lo VALIDA
        # (require_current_preflight now=T0) ⇒ checked_at>now False. (self._clock queda sin uso; la inyección
        # del ctor se deja intacta — bootstrap sigue pasando clock=_utc_now, inocuo; sin cambios de wiring.)
        # Catálogo: constantes IMPORTADAS de capabilities (§E-§H d041978d en CAPA 2); no hardcodeadas.
        catalog = google_creative_catalog(
            AUDITED_PROJECT, audit_results_sha256=AUDIT_RESULTS_SHA256,
            reference_results_sha256=REFERENCE_RESULTS_SHA256,
            service_checks_sha256=SERVICE_CHECKS_SHA256)
        # F1 (nit Consultor): el preflight corre ANTES del gate del flag → si el preflight DETERMINISTA
        # falla (proyecto/facturación/servicio/permiso/vigencia = ValueError), el E2E inerte PARA aquí, NO
        # en el flag → código estable PREFLIGHT_INVALID para distinguir «Vertex/Cloud pendiente» de
        # GATE_NOT_OPEN. Un fallo TRANSITORIO del cliente (GoogleCreativePreflightError ⊂ RuntimeError, NO
        # ValueError) NO se captura aquí: propaga como transitorio, no se enmascara como pre-POST terminal.
        try:
            preflight = creative_google_preflight(
                GoogleCreativeHttpClient(self._session_factory()), token, catalog,
                request.model, _REQUIRED_SERVICES, now=now)
            preflight_receipt = google_preflight_receipt(preflight, catalog, now=now)
        except ValueError as error:
            # F3-split: PRESERVA el código fino de CAPA 1 que porte creative_google_preflight (PROJECT_INACTIVE/
            # BILLING_INACTIVE/SERVICE_MISSING/PERMISSION_MISSING) o require_current_preflight vía el receipt;
            # uncoded (p.ej. el guard de entrada interno :77) → PREFLIGHT_INVALID genérico. Sigue pre-POST, 0 cargo.
            inner = getattr(error, 'dispatch_code', None)
            raise ClipsOnlyLiveProviderError(
                "El preflight de Google no está vigente para el despacho.",
                code=inner if isinstance(inner, str) and inner in CLIPS_ONLY_DISPATCH_CODES
                else PREFLIGHT_INVALID) from error
        # input_binding: recibo(s) VERIFICADO(s) del fotograma vía la store de assets (puerto 2); texto -> None.
        receipts = self._input_receipt_resolver(c, owner, claim, request)
        if receipts:
            try:
                input_binding = bind_google_owned_inputs(request, str(owner["id"]), tuple(receipts))
            except ValueError as error:
                # F1: código estable POR FORMA (no por mensaje). El fallo del bind de propiedad de un
                # first-frame §H → FIRSTFRAME_NOT_OWNED; cualquier otro input → INPUT_NOT_OWNED. Sigue
                # siendo pre-POST (0 cargo); solo añade el código para el log del worker.
                raise ClipsOnlyLiveProviderError(
                    "El input del clip no tiene prueba de propiedad verificable.",
                    code=FIRSTFRAME_NOT_OWNED if _is_first_frame_request(request)
                    else INPUT_NOT_OWNED) from error
        else:
            input_binding = None
        bucket = clips_only_output_bucket(self._settings, google_project=google_project)
        if not bucket:
            raise ClipsOnlyLiveProviderError("No hay bucket de salida §6 resuelto para el despacho.")
        return ClipsOnlyLiveParts(
            catalog=catalog, preflight=preflight, preflight_receipt=preflight_receipt,
            input_binding=input_binding, output_bucket=bucket,
            allowed_buckets=(bucket,), allowed_output_buckets=(bucket,),
            identity=identity)
