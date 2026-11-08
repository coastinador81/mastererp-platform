"""F1: CÓDIGOS ESTABLES enumerados para los fallos PRE-POST del despacho creativo (clips-only).

Convergencia Consultor+REA (28-10): en vez de scrubbing de texto libre (frágil + D-PROTECCIÓN), cada fallo
pre-POST se mapea a un CÓDIGO estable. Un código es DATO OPERATIVO, no mensaje: no filtra
gs:// / project-id / model-id / hashes / USD, así que es seguro de loguear y persistir. El worker loguea el
código (NO `type(error).__name__`, NO el mensaje). El E2E inerte es DISCRIMINANTE: `GATE_NOT_OPEN` =
el pipeline llegó hasta el interruptor del flag (todo lo previo verde); cualquier otro código = parar.

Este módulo NO importa nada del paquete (evita ciclos): es consumido por dispatch_gate (que codifica sus
raise con `CodedDispatchError`) y por las excepciones clips-only (que portan `dispatch_code`). El
clasificador lee SOLO el atributo `dispatch_code`; nunca inspecciona el texto del mensaje.
"""
from __future__ import annotations

# Códigos (dato operativo). Estables para el E2E discriminante; añadir SOLO al final.
GATE_NOT_OPEN = 'GATE_NOT_OPEN'                       # flag maestro o gate_decider cerrado (dispatch_gate)
FIRSTFRAME_NOT_OWNED = 'FIRSTFRAME_NOT_OWNED'         # first-frame GCS (§H) sin prueba de propiedad
INPUT_NOT_OWNED = 'INPUT_NOT_OWNED'                   # otro input declarado sin/≠ recibo de propiedad
ENDPOINT_PROJECT_MISMATCH = 'ENDPOINT_PROJECT_MISMATCH'   # endpoint rehidratado ≠ preflight.project
BODY_LIMITS = 'BODY_LIMITS'                           # cuerpo Veo ≠ límites aprobados (8s/720p)
PREFIX_MISMATCH = 'PREFIX_MISMATCH'                   # prefijo §6/129 derivado ≠ persistido
SCOPE_MISMATCH = 'SCOPE_MISMATCH'                     # 119: proyecto pagador ≠ cotización
PREFLIGHT_INVALID = 'PREFLIGHT_INVALID'               # preflight no vigente / servicios
TOKEN_INVALID = 'TOKEN_INVALID'                       # el token_provider no dio un Bearer válido
CONTEXT_INVALID = 'CONTEXT_INVALID'                   # context_loader (forma/fence/sha)
LIVE_PROVIDER = 'LIVE_PROVIDER'                       # resolve() de piezas vivas (genérico)
SHA_MISMATCH = 'SHA_MISMATCH'                         # requestSha256 ≠ autoridad aprobada
# F1-ext (hallazgo E2E 28-10: PRE_POST_UNCLASSIFIED): sitios pre-POST que F1 no cubría.
READER_INVALID = 'READER_INVALID'                     # reader: reconstrucción 090 (región/límites/filas/attempt)
EXECUTION_LOADER_INVALID = 'EXECUTION_LOADER_INVALID' # execution_loader: quote_id/quote_snapshot/execution
CLAIM_CONTEXT_INVALID = 'CLAIM_CONTEXT_INVALID'       # load_google_claim_context: request reconstruido/verificado
PROVIDER_BINDING_MISMATCH = 'PROVIDER_BINDING_MISMATCH'  # bind_google_provider_request: namespace/fingerprint
# F2b-split (E2E 28g dio CLAIM_CONTEXT_INVALID = load_google_claim_context, genérico). Split 3-vías para pinar:
CLAIM_STATE_INVALID = 'CLAIM_STATE_INVALID'           # checks de identidad/autorización del claim (:27/:32/:36/:40)
REHYDRATE_INVALID = 'REHYDRATE_INVALID'               # rehydrate_admitted_execution: re-validación del grafo (:33)
CLAIM_VERIFY_INVALID = 'CLAIM_VERIFY_INVALID'         # (padre, ya no se lanza) operación/reconstrucción persistida
# F2c-split (E2E 28h dio CLAIM_VERIFY_INVALID = operación/reconstrucción persistida, genérico). El round-trip
# PURO de la petición pasa OFFLINE con los constructores reales para toda entrada realista (prompt es/9:16/jpeg)
# ⇒ la causa viva está en la ESTRUCTURA persistida (quote_snapshot/rehidratación) o el endpoint/modelo, no
# reproducible en puro. Sub-split 3-vías de los 3 sitios CLAIM_VERIFY para pinar la línea exacta:
VERIFY_STRUCT_INVALID = 'VERIFY_STRUCT_INVALID'       # operación persistida no verificable (estructura :57-66)
VERIFY_SHA_SNAPSHOT_MISMATCH = 'VERIFY_SHA_SNAPSHOT_MISMATCH'  # sha persistido ≠ hash canónico del snapshot persistido
VERIFY_RECONSTRUCT_INVALID = 'VERIFY_RECONSTRUCT_INVALID'  # google_request_from_snapshot falló (reconstrucción :68-73)
VERIFY_ENDPOINT_MODEL_INVALID = 'VERIFY_ENDPOINT_MODEL_INVALID'  # modelo/endpoint reconstruido ≠ operación (:74-76)
# Transporte — camino VIVO del despacho (dispatch_once + _require_veo_durable_output + H13), que el E2E
# INERTE nunca alcanza (para en el flag gate ANTES de dispatch_once). Hallazgo 1er clip vivo (29-10):
# muchos `raise ValueError` SIN código en el transporte → PRE_POST_UNCLASSIFIED. Se codean (ext-F1) para
# que el 1er dispatch VIVO sea DISCRIMINANTE. Todos pre-POST (antes del POST a aiplatform) → 0 cargo.
ENDPOINT_LOCATION_MISMATCH = 'ENDPOINT_LOCATION_MISMATCH'   # región del endpoint ≠ autorizada (dispatch_once)
INPUT_BINDING_UNEXPECTED = 'INPUT_BINDING_UNEXPECTED'       # input_binding presente sin manifest
INLINE_MEDIA_UNMANIFESTED = 'INLINE_MEDIA_UNMANIFESTED'     # media inline en el cuerpo fuera del manifiesto
OWNED_INPUTS_INVALID = 'OWNED_INPUTS_INVALID'               # require_google_owned_inputs: propiedad del input
DURABLE_PARAMS_INVALID = 'DURABLE_PARAMS_INVALID'           # cuerpo Veo durable sin parameters dict (inyección D1)
DURABLE_OUTPUT_REQUIRED = 'DURABLE_OUTPUT_REQUIRED'         # Veo durable sin autorización de salida
DURABLE_AUTH_INVALID = 'DURABLE_AUTH_INVALID'               # VeoOutputAuthorization no válida
DURABLE_PREFIX_UNAUTHORIZED = 'DURABLE_PREFIX_UNAUTHORIZED' # prefijo §6 no autorizado (forma/owner/attempt/operation)
OUTPUT_BUCKET_NOT_ALLOWED = 'OUTPUT_BUCKET_NOT_ALLOWED'     # bucket de salida §6 NO en la allowlist (config release-gated vacía)
DURABLE_STORAGEURI_MISMATCH = 'DURABLE_STORAGEURI_MISMATCH' # storageUri (inyectado) ≠ prefijo autoritativo
BUCKET_PERMISSION_DENIED = 'BUCKET_PERMISSION_DENIED'       # H13 bucket_create_permission: sin storage.objects.create / red
RESERVATION_INVALID = 'RESERVATION_INVALID'                 # _attempt(reservation): intento no reservado / id no válido
ENDPOINT_INVALID = 'ENDPOINT_INVALID'                       # _endpoint/_endpoint_location: endpoint reconstruido no parseable
# F3-split (PREFLIGHT_INVALID era genérico: DOS capas lo emitían — la sonda VIVA de infra en resolve Y la
# vigencia en el dispatch-gate — y el log no distinguía). Convergencia Consultor+REA (29-10): split POR CAPA,
# condiciones IDÉNTICAS, solo código más fino, sin debilitar, behavior-preserving. PREFLIGHT_INVALID queda como
# fallback genérico (ValueError de preflight sin código). Capa 1 = resolve-fetch (creative_google_preflight,
# aprovisionamiento del proyecto del dueño):
PROJECT_INACTIVE = 'PROJECT_INACTIVE'                 # proyecto Google no activo (creative_google_preflight :82)
BILLING_INACTIVE = 'BILLING_INACTIVE'                 # facturación Google no activa (:85)
SERVICE_MISSING = 'SERVICE_MISSING'                   # falta servicio requerido (aiplatform/storage) (:90)
PERMISSION_MISSING = 'PERMISSION_MISSING'             # falta permiso (services.use / endpoints.predict) (:100)
# Capa 2 = dispatch-gate (require_current_preflight, vigencia en el despacho):
CHECKED_FUTURE = 'CHECKED_FUTURE'                     # checked_at > now (síntoma de dos-relojes) (:119)
EXPIRED = 'EXPIRED'                                   # expires_at <= now (TTL 10min agotado)
FIELD = 'FIELD'                                       # identidad/estructura (project/catalog_sha/model/status/dispatch_ready/ventana/tipos)
PRE_POST_UNCLASSIFIED = 'PRE_POST_UNCLASSIFIED'       # ValueError pre-POST sin código (fallback)

CLIPS_ONLY_DISPATCH_CODES = frozenset({
    GATE_NOT_OPEN, FIRSTFRAME_NOT_OWNED, INPUT_NOT_OWNED, ENDPOINT_PROJECT_MISMATCH,
    BODY_LIMITS, PREFIX_MISMATCH, SCOPE_MISMATCH, PREFLIGHT_INVALID, TOKEN_INVALID,
    CONTEXT_INVALID, LIVE_PROVIDER, SHA_MISMATCH, READER_INVALID,
    EXECUTION_LOADER_INVALID, CLAIM_CONTEXT_INVALID, PROVIDER_BINDING_MISMATCH,
    CLAIM_STATE_INVALID, REHYDRATE_INVALID, CLAIM_VERIFY_INVALID,
    VERIFY_STRUCT_INVALID, VERIFY_SHA_SNAPSHOT_MISMATCH, VERIFY_RECONSTRUCT_INVALID,
    VERIFY_ENDPOINT_MODEL_INVALID,
    ENDPOINT_LOCATION_MISMATCH, INPUT_BINDING_UNEXPECTED, INLINE_MEDIA_UNMANIFESTED,
    OWNED_INPUTS_INVALID, DURABLE_PARAMS_INVALID, DURABLE_OUTPUT_REQUIRED,
    DURABLE_AUTH_INVALID, DURABLE_PREFIX_UNAUTHORIZED, DURABLE_STORAGEURI_MISMATCH,
    BUCKET_PERMISSION_DENIED, RESERVATION_INVALID, ENDPOINT_INVALID,
    OUTPUT_BUCKET_NOT_ALLOWED,
    PROJECT_INACTIVE, BILLING_INACTIVE, SERVICE_MISSING, PERMISSION_MISSING,
    CHECKED_FUTURE, EXPIRED, FIELD,
    PRE_POST_UNCLASSIFIED,
})


class CodedDispatchError(ValueError):
    """`ValueError` pre-POST que PORTA un código estable. Sigue siendo `ValueError`, así que el envelope lo
    trata como abort pre-POST igual (0 cargo intacto); el código es solo metadato para el log/journal."""

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.dispatch_code = code


def classify_dispatch_error(error: BaseException) -> str:
    """Devuelve el código estable del fallo pre-POST. Lee SOLO `error.dispatch_code` (lo portan
    `CodedDispatchError` y las excepciones clips-only); nunca el texto. Desconocido → PRE_POST_UNCLASSIFIED."""
    code = getattr(error, 'dispatch_code', None)
    if isinstance(code, str) and code in CLIPS_ONLY_DISPATCH_CODES:
        return code
    return PRE_POST_UNCLASSIFIED
