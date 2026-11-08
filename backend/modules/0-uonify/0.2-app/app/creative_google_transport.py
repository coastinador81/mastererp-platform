"""Transporte Google de una sola llamada para un intento ya reservado.

No reserva intentos, no cambia el ledger y no reintenta. El coordinador futuro
debe confirmar la transacción de reserva antes de invocarlo y persistir después
el recibo pequeño, nunca los bytes inline dentro de PostgreSQL.
"""

from dataclasses import dataclass
import re
from urllib.parse import urlsplit
from uuid import UUID

import requests

from .creative_cloud_tts_contracts import (CloudTtsRequest,
                                           cloud_tts_completed)
from .creative_google_input_ownership import (
    GoogleOwnedInputBinding, require_google_owned_inputs)
from .creative_google_preflight_client import bucket_create_permission
from .creative_google_dispatch_codes import (
    BUCKET_PERMISSION_DENIED, CodedDispatchError, DURABLE_AUTH_INVALID,
    DURABLE_OUTPUT_REQUIRED, DURABLE_PARAMS_INVALID, DURABLE_PREFIX_UNAUTHORIZED,
    DURABLE_STORAGEURI_MISMATCH, ENDPOINT_INVALID, ENDPOINT_LOCATION_MISMATCH,
    ENDPOINT_PROJECT_MISMATCH, INLINE_MEDIA_UNMANIFESTED,
    INPUT_BINDING_UNEXPECTED, OUTPUT_BUCKET_NOT_ALLOWED, OWNED_INPUTS_INVALID,
    RESERVATION_INVALID, SHA_MISMATCH, TOKEN_INVALID)
from .creative_image_contracts import ImageRequest, image_completed
from .creative_music_contracts import MusicRequest, music_completed
from .creative_request_fingerprint import fingerprint
from .creative_video_contracts import (VideoRequest, omni_completed,
                                       omni_interaction_id,
                                       veo_endpoint_host, veo_operation_name)
from .creative_voiceover_contracts import (VoiceoverRequest,
                                           voiceover_completed)


_HASH = re.compile(r'[0-9a-f]{64}\Z')
_PROJECT = re.compile(r'/projects/([^/]+)/')

# A3/U8: salida durable obligatoria para Veo. El prefijo autoritativo se deriva en la
# RESERVA (owner verificado en BD + bucket de configuración), se persiste en la fila del
# intento y lo aporta el gate como VeoOutputAuthorization; aquí NO se confía en el
# storageUri del snapshot del body. Interruptor de obligatoriedad (una inline sin
# autorización ⇒ rechazo pre-POST, 0 HTTP): INVARIANTE DE SEGURIDAD, no palanca de runtime.
# §6/Opción 1 del Consultor: constante de árbol que el release RC2 pone en True de forma
# ATÓMICA con el wiring durable (gate/envelope/reserva/129); un True solo existe cuando ese
# camino existe. Un constante no se puede misconfigurar a False en runtime (fail-closed >
# toggle). En RC1 (ensayo pre-wiring) era False; con §6 cableado, RC2 = True.
VEO_DURABLE_OUTPUT_REQUIRED = True
# H1 (RC2): la forma canónica es la del namespace del proveedor
# (creative_google_provider_namespace.google_provider_output_namespace):
# …/{owner}/{attempt}/provider/{operationUuid}/, donde operationUuid es
# authority.operation_id (UUID nuestro, pre-POST), no el nombre de la operación LRO.
_VEO_OUTPUT_PREFIX = re.compile(
    r'gs://(?P<bucket>[a-z0-9][a-z0-9._-]{1,220}[a-z0-9])/'
    r'creative/staging/google/(?P<owner>[0-9a-f-]{36})/(?P<attempt>[0-9a-f-]{36})/'
    r'provider/(?P<operation>[0-9a-f-]{36})/\Z')


class GoogleDispatchError(Exception):
    """Google rechazó la petición antes de entregar un resultado aceptado."""


class GoogleDispatchUnknown(GoogleDispatchError):
    """Google pudo aceptar la petición; nunca debe repetirse automáticamente.

    Códigos inciertos: 409, 499, 5xx, 2xx distinto de 200, errores de red y
    cualquier respuesta 200 ilegible o con forma inesperada tras el POST.
    """


class GoogleDispatchRejectedFinal(GoogleDispatchError):
    """Rechazo determinista y terminal del proveedor.

    4xx no transitorio (400/401/403/404…) o un 200 con bloqueo de seguridad.
    No se generó nada adoptable y no debe reintentarse.

    `status_code`/`reason` (micro-parche 27-10, veredicto oferta-motores Q1): llevan el código HTTP y
    el motivo textual del cuerpo de error para que el clasificador de disponibilidad distinga un 404
    de modelo retirado (→ fallback seguro) de un 400/401/403 terminal. Ambos opcionales (None por
    defecto) → ADITIVO: las subclases (Safety/Empty) y los callers que solo pasan el mensaje no
    cambian. Es dato INTERNO (observabilidad/decisión), nunca se muestra al cliente."""

    def __init__(self, message: str, *, status_code: int | None = None,
                 reason: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.reason = reason


class GoogleDispatchRejectedRetryable(GoogleDispatchError):
    """Rechazo transitorio del proveedor (408/429).

    No se generó nada; es seguro reintentar más tarde según la política de cuotas.
    """


class GoogleDispatchSafetyBlocked(GoogleDispatchRejectedFinal):
    """Rechazo final por parada de seguridad (blockReason / finishReason RAI)."""


class GoogleDispatchEmptyResult(GoogleDispatchRejectedFinal):
    """200 con parada normal (STOP) pero sin medios: refusal determinista."""


def _rejection_reason(response) -> str | None:
    """Motivo textual de un rechazo no-200 (p. ej. «Publisher model … was not found» en un 404),
    para que el clasificador distinga un 404 de modelo retirado de otro 4xx. Lee el cuerpo de error
    de forma defensiva; NUNCA lanza (cuerpo ilegible ⇒ None). No toca la petición ni el token (H4)."""
    try:
        body = response.json()
    except Exception:
        return None
    error = body.get('error') if isinstance(body, dict) else None
    if not isinstance(error, dict):
        return None
    for key in ('status', 'message'):
        value = error.get(key)
        if isinstance(value, str) and value:
            return value
    return None


# Motivos de parada (finishReason/blockReason) que Google usa para rechazar
# contenido de forma determinista: un 200 con cualquiera de estos es un rechazo
# final, no un resultado incierto. Valores verificados contra el enum del SDK
# (types.py:510-560); se excluyen PERSONAL_INFO y CHILD (no existen) y se incluyen
# los específicos de imagen. STOP no entra aquí (se trata en el parser por modelo).
_SAFETY_BLOCK = frozenset({
    'SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_PROHIBITED_CONTENT',
    'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_RECITATION', 'IMAGE_OTHER',
    'NO_IMAGE'})

# finishReasons TERMINALES (la generación acabó) que, sin medio, son un empty
# determinista: un unknown síncrono no se puede reconciliar, así que marcarlos como
# rejected_final es correcto. Sin finishReason NO se asume terminal → sigue unknown.
_TERMINAL_NO_MEDIA = frozenset({'STOP', 'MAX_TOKENS', 'OTHER'})


@dataclass(frozen=True)
class GoogleDispatchResult:
    attempt_id: str
    request_sha256: str
    state: str
    provider_operation: str | None
    outputs: tuple[object, ...]
    receipt: dict


def _attempt(reservation: dict) -> str:
    if not isinstance(reservation, dict) or reservation.get('status') != 'reserved':
        raise ValueError('El intento Google no está reservado.')
    try:
        return str(UUID(reservation.get('attemptId', '')))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError('Identificador de intento no válido.') from error


def _endpoint(request) -> str:
    url = urlsplit(request.endpoint)
    if isinstance(request, CloudTtsRequest):
        if (url.scheme != 'https' or url.hostname != 'texttospeech.googleapis.com'
                or url.path != '/v1/text:synthesize' or url.query or url.fragment):
            raise ValueError('Endpoint Cloud TTS no válido.')
        return request.quota_project
    project = _PROJECT.search(url.path)
    if url.scheme != 'https' or not project:
        raise ValueError('Endpoint Google no válido.')
    model_path = f'/publishers/google/models/{request.model}'
    if isinstance(request, ImageRequest):
        valid = (url.hostname == 'aiplatform.googleapis.com'
                 and url.path.endswith(model_path + ':generateContent'))
    elif isinstance(request, VoiceoverRequest):
        valid = (url.hostname == 'europe-southwest1-aiplatform.googleapis.com'
                 and url.path.endswith(model_path + ':generateContent'))
    elif isinstance(request, VideoRequest) and request.model.startswith('veo-'):
        # 12b: location parametrizada; el host debe casar con la location del path.
        loc = re.search(r'/locations/([^/]+)/', url.path)
        try:
            host_ok = bool(loc) and url.hostname == veo_endpoint_host(loc.group(1))
        except ValueError:
            host_ok = False
        valid = host_ok and url.path.endswith(model_path + ':predictLongRunning')
    elif isinstance(request, (VideoRequest, MusicRequest)):
        valid = (url.hostname == 'aiplatform.googleapis.com'
                 and url.path.endswith('/locations/global/interactions'))
    else:
        valid = False
    if not valid:
        raise ValueError('Endpoint o modelo Google no admitido.')
    return project.group(1)


def _endpoint_location(request) -> str | None:
    """H5: región efectiva derivada POR TIPO, coherente con la validación de host que
    ya hace `_endpoint` (no un regex suelto del path: en voiceover la región viaja en el
    HOST). Se llama tras `_endpoint`, con el tipo/forma ya validados.

    - CloudTtsRequest: None (host fijo texttospeech, sin /locations/).
    - ImageRequest, VideoRequest/MusicRequest de interacciones: 'global'.
    - VoiceoverRequest: 'europe-southwest1' (host regional ya validado por `_endpoint`).
    - VideoRequest veo: la location del path, que `_endpoint` ya ató a su host.
    """
    if isinstance(request, CloudTtsRequest):
        return None
    if isinstance(request, ImageRequest):
        return 'global'
    if isinstance(request, VoiceoverRequest):
        return 'europe-southwest1'
    if isinstance(request, VideoRequest) and request.model.startswith('veo-'):
        match = re.search(r'/locations/([^/]+)/', urlsplit(request.endpoint).path)
        return match.group(1) if match else None
    if isinstance(request, (VideoRequest, MusicRequest)):
        return 'global'
    return None


def _receipt(attempt_id, request_hash, state, operation, outputs, payload,
             provider='google_vertex_ai'):
    hashes = [item.sha256 for item in outputs if hasattr(item, 'sha256')]
    usage = payload.get('usage') or payload.get('usageMetadata')
    return {'attemptId': attempt_id, 'requestSha256': request_hash,
            'provider': provider, 'state': state,
            'providerOperation': operation, 'outputSha256': hashes,
            'usage': usage if isinstance(usage, dict) else None}


def _has_inline_media(value) -> bool:
    if isinstance(value, list):
        return any(_has_inline_media(item) for item in value)
    if not isinstance(value, dict):
        return False
    if 'inlineData' in value or 'bytesBase64Encoded' in value:
        return True
    if value.get('type') in ('image', 'video', 'audio') and 'data' in value:
        return True
    return any(_has_inline_media(item) for item in value.values())


def _safety_block(payload):
    """Devuelve el motivo concreto de parada de seguridad (str) o None.

    Mira `promptFeedback.blockReason` y el `finishReason` de cada candidata contra
    `_SAFETY_BLOCK`. Se devuelve el valor exacto para registrarlo en el journal.
    """
    if not isinstance(payload, dict):
        return None
    feedback = payload.get('promptFeedback')
    if isinstance(feedback, dict) and feedback.get('blockReason'):
        return str(feedback.get('blockReason'))
    candidates = payload.get('candidates')
    if isinstance(candidates, list):
        for candidate in candidates:
            if isinstance(candidate, dict):
                reason = candidate.get('finishReason')
                if reason in _SAFETY_BLOCK:
                    return str(reason)
    return None


def _terminal_without_media(payload) -> bool:
    """True si un 200 con `candidates` acaba en un finishReason TERMINAL (STOP,
    MAX_TOKENS u OTHER) pero sin medios.

    Para los endpoints de generateContent que esperan medio (imagen/voz/omni), un
    final terminal sin ninguna parte `inlineData`/`bytesBase64Encoded` —incluido
    cuando no hay `content`/`parts`— es un refusal determinista, no un resultado
    incierto. Sin finishReason NO se asume terminal (sigue unknown). No dispara con
    Veo (predictLongRunning, sin `candidates`) ni con respuestas con medio.
    """
    if not isinstance(payload, dict):
        return False
    candidates = payload.get('candidates')
    if not isinstance(candidates, list) or not candidates:
        return False
    for candidate in candidates:
        if (not isinstance(candidate, dict)
                or candidate.get('finishReason') not in _TERMINAL_NO_MEDIA):
            return False
        content = candidate.get('content')
        parts = content.get('parts') if isinstance(content, dict) else None
        if isinstance(parts, list) and any(
                isinstance(part, dict)
                and ('inlineData' in part or 'bytesBase64Encoded' in part)
                for part in parts):
            return False  # trae medio → es un éxito, no un empty
    return True


def _music_terminal_no_audio(payload) -> bool:
    """14(b): True si un 200 de Lyria (interactions) está BIEN FORMADO (`outputs` o
    `steps` como lista) pero sin parte de audio → empty determinista (rejected_final),
    no incierto. Un 200 ilegible (ni outputs ni steps) devuelve False → lo trata el
    parser como unknown. La forma exacta de un bloqueo se fijará cuando aparezca uno.
    """
    if not isinstance(payload, dict):
        return False
    parts = payload.get("outputs")
    if not isinstance(parts, list):
        if not isinstance(payload.get("steps"), list):
            return False
        parts = [p for st in payload.get("steps")
                 if isinstance(st, dict) and st.get("type") == "model_output"
                 for p in (st.get("content") or [])]
    return not any(isinstance(p, dict) and p.get("type") == "audio" for p in parts)


@dataclass(frozen=True)
class VeoOutputAuthorization:
    """Autorización de salida durable Veo, construida por el gate desde la fila del
    intento (owner verificado + prefijo persistido en la reserva) y la configuración del
    servidor (allowlist de buckets). Nunca se arma con datos del snapshot del body."""
    expected_output_prefix: str
    attempt_owner_user_id: str
    attempt_operation_id: str
    allowed_output_buckets: tuple


def _require_veo_durable_output(body, attempt_id: str,
                                authorization: "VeoOutputAuthorization | None") -> None:
    """Valida (pre-POST) que una generación Veo predictLongRunning escriba su salida al
    prefijo durable autoritativo del intento.

    Sin autorización: rechaza solo si el release activó VEO_DURABLE_OUTPUT_REQUIRED
    (una inline ya no puede salir a la red). Con autorización: el prefijo debe tener la
    forma gs://{bucket∈allowlist}/creative/staging/google/{owner}/{attemptId}/, con el
    attemptId de la reserva y el owner de la fila del intento (no un parámetro suelto), y
    el storageUri del body (UNTRUSTED) debe ser EXACTAMENTE ese prefijo.
    """
    params = body.get('parameters') if isinstance(body, dict) else None
    storage_uri = params.get('storageUri') if isinstance(params, dict) else None
    if authorization is None:
        if VEO_DURABLE_OUTPUT_REQUIRED:
            raise CodedDispatchError(
                'Veo exige salida durable (storageUri) autorizada del intento.',
                code=DURABLE_OUTPUT_REQUIRED)
        return
    if not isinstance(authorization, VeoOutputAuthorization):
        raise CodedDispatchError('Autorización de salida Veo no válida.',
                                 code=DURABLE_AUTH_INVALID)
    prefix = authorization.expected_output_prefix
    match = _VEO_OUTPUT_PREFIX.fullmatch(prefix) if isinstance(prefix, str) else None
    if (match is None
            or match.group('attempt') != attempt_id
            or not isinstance(authorization.attempt_owner_user_id, str)
            or match.group('owner') != authorization.attempt_owner_user_id
            or not isinstance(authorization.attempt_operation_id, str)
            or match.group('operation') != authorization.attempt_operation_id):
        raise CodedDispatchError('Prefijo de salida Veo no autorizado para el intento.',
                                 code=DURABLE_PREFIX_UNAUTHORIZED)
    # Split del check del bucket (lead del Consultor): la allowlist de salida (settings.creative_output_buckets
    # = UONIFY_CREATIVE_OUTPUT_BUCKETS) es config RELEASE-GATED, vacía por defecto. Un código propio distingue
    # «bucket no en allowlist» (poblado go-live faltante) de un mismatch de forma/identidad del prefijo.
    if match.group('bucket') not in tuple(authorization.allowed_output_buckets):
        raise CodedDispatchError('El bucket de salida Veo no está en la allowlist autorizada.',
                                 code=OUTPUT_BUCKET_NOT_ALLOWED)
    if not isinstance(storage_uri, str) or storage_uri != prefix:
        raise CodedDispatchError(
            'storageUri Veo no coincide con el prefijo autoritativo del intento.',
            code=DURABLE_STORAGEURI_MISMATCH)


def veo_output_authorization(output_prefix, owner_user_id: str, attempt_id: str,
                             allowed_output_buckets) -> "VeoOutputAuthorization":
    """§6: arma la autorización de salida durable desde el prefijo PERSISTIDO en la reserva
    (columna de la 129), el owner/attempt de la FILA del intento y la allowlist de SALIDA
    de configuración. Guarda de consistencia: el prefijo DEBE casar con owner y attempt
    (fail-closed si no); el operationUuid sale del propio prefijo. Nunca se arma con datos
    del body (untrusted)."""
    match = (_VEO_OUTPUT_PREFIX.fullmatch(output_prefix)
             if isinstance(output_prefix, str) else None)
    if (match is None or match.group('owner') != owner_user_id
            or match.group('attempt') != attempt_id):
        # Completeness (NIT Consultor): este build de la autorización corre en el envelope (pasó en 28k);
        # codeado igual para que NINGÚN pre-POST del camino vivo quede UNCLASSIFIED. DURABLE_PREFIX_UNAUTHORIZED
        # (misma familia: prefijo persistido ≠ owner/attempt). CodedDispatchError⊂ValueError, pre-POST, 0 cargo.
        raise CodedDispatchError(
            'El prefijo de salida persistido no corresponde al owner/intento.',
            code=DURABLE_PREFIX_UNAUTHORIZED)
    return VeoOutputAuthorization(output_prefix, owner_user_id,
                                  match.group('operation'),
                                  tuple(allowed_output_buckets))


def dispatch_once(reservation: dict, request, expected_request_sha256: str,
                  token: str, session: requests.Session, *,
                  input_binding: GoogleOwnedInputBinding | None = None,
                  output_authorization: "VeoOutputAuthorization | None" = None,
                  expected_project: str | None = None,
                  expected_location: str | None = None
                  ) -> GoogleDispatchResult:
    """Envía exactamente un POST; timeout/5xx/200 ilegible quedan `unknown`.

    H5: `expected_project`/`expected_location` (de la autoridad del intento, los pasa el
    envelope en RC2; None en callers pre-wiring) atan el endpoint REHIDRATADO (untrusted)
    al proyecto/región autorizados. Son comprobaciones estrictamente pre-POST: un fallo
    lanza ValueError ANTES de abrir la red (0 HTTP ⇒ el envelope registra `aborted`).
    """
    try:
        attempt_id = _attempt(reservation)
    except CodedDispatchError:
        raise
    except ValueError as error:
        raise CodedDispatchError('El intento de la reserva no es válido.',
                                 code=RESERVATION_INVALID) from error
    try:
        project = _endpoint(request)
    except CodedDispatchError:
        raise
    except ValueError as error:
        raise CodedDispatchError('El endpoint reconstruido no es parseable.',
                                 code=ENDPOINT_INVALID) from error
    if expected_project is not None and project != expected_project:
        raise CodedDispatchError(
            'El proyecto del endpoint Google no coincide con el autorizado.',
            code=ENDPOINT_PROJECT_MISMATCH)
    try:
        endpoint_location = _endpoint_location(request)
    except CodedDispatchError:
        raise
    except ValueError as error:
        raise CodedDispatchError('La región del endpoint reconstruido no es parseable.',
                                 code=ENDPOINT_INVALID) from error
    # CloudTtsRequest no lleva región en la ruta (`_endpoint_location` None): su host fijo
    # texttospeech y el proyecto (quota_project) ya la fijan, así que la región no aplica y
    # no debe compararse (authority.google_location es str no-None y rechazaría el TTS).
    if (expected_location is not None and endpoint_location is not None
            and endpoint_location != expected_location):
        raise CodedDispatchError(
            'La región del endpoint Google no coincide con la autorizada.',
            code=ENDPOINT_LOCATION_MISMATCH)
    if (not isinstance(expected_request_sha256, str)
            or not _HASH.fullmatch(expected_request_sha256)
            or fingerprint(request).sha256 != expected_request_sha256):
        raise CodedDispatchError('La petición Google no coincide con la reserva aprobada.',
                                 code=SHA_MISMATCH)
    manifest = getattr(request, 'input_manifest', ())
    if manifest:
        try:
            require_google_owned_inputs(request, input_binding)
        except CodedDispatchError:
            raise
        except ValueError as error:
            raise CodedDispatchError(
                'La propiedad de los inputs Google no se pudo verificar.',
                code=OWNED_INPUTS_INVALID) from error
    elif input_binding is not None:
        raise CodedDispatchError('Binding de inputs Google inesperado.',
                                 code=INPUT_BINDING_UNEXPECTED)
    if _has_inline_media(request.body) and not manifest:
        raise CodedDispatchError('La petición oculta recursos fuera del manifiesto autorizado.',
                                 code=INLINE_MEDIA_UNMANIFESTED)
    # D1 (Veo durable defer-and-inject, 29-10): el cuerpo POSTeado puede diferir del cuerpo FINGERPRINTEADO
    # SÓLO en `parameters.storageUri`, inyectado desde el prefijo AUTORITATIVO (output_authorization), nunca
    # del body. El fingerprint check (más arriba) ya corrió sobre `request` ORIGINAL (sin storageUri).
    post_body = request.body
    if (isinstance(request, VideoRequest) and request.model.startswith('veo-')
            and request.endpoint.endswith(':predictLongRunning')):
        if output_authorization is not None:
            # Inyección condicional: si el request DIFIERE el storageUri (clip §H y camino veo durable que
            # cotiza con output_uri=None), se pone AQUÍ = expected_output_prefix (autoritativo, server-side),
            # único campo cambiado sobre el cuerpo ya fingerprinteado. Si el cuerpo YA trae storageUri (camino
            # veo general que cotiza con output_uri), se respeta tal cual y el transporte lo valida igual
            # (==prefix) → no se regresa ese camino. En ambos casos _require_veo_durable_output exige
            # storageUri==prefix, así que una inyección/valor que no case fail-closa pre-POST (0 cargo).
            params = request.body.get('parameters')
            if not isinstance(params, dict):
                raise CodedDispatchError('El cuerpo Veo durable no trae parameters.',
                                         code=DURABLE_PARAMS_INVALID)
            if 'storageUri' not in params:
                post_body = {**request.body,
                             'parameters': {**params,
                                            'storageUri': output_authorization.expected_output_prefix}}
        _require_veo_durable_output(post_body, attempt_id, output_authorization)
        if output_authorization is not None:
            # H13: ANTES del POST a Veo, comprobar storage.objects.create en el bucket de
            # SALIDA autorizado (testIamPermissions, solo lectura). fail-closed: sin
            # permiso → ValueError pre-POST → 0 HTTP a Veo (el envelope registra aborted).
            _prefix = _VEO_OUTPUT_PREFIX.fullmatch(
                output_authorization.expected_output_prefix)
            try:
                bucket_create_permission(
                    session, token, _prefix.group('bucket') if _prefix else '')
            except CodedDispatchError:
                raise
            except ValueError as error:
                raise CodedDispatchError(
                    'No se pudo comprobar el permiso de escritura del bucket de salida.',
                    code=BUCKET_PERMISSION_DENIED) from error
    if not isinstance(token, str) or not token:
        raise CodedDispatchError('Autorización Google ausente.', code=TOKEN_INVALID)
    try:
        headers = {'Authorization': 'Bearer ' + token,
                   'Content-Type': 'application/json'}
        if isinstance(request, CloudTtsRequest):
            headers['x-goog-user-project'] = project
        response = session.request(
            'POST', request.endpoint,
            headers=headers,
            json=post_body, timeout=(10, 120), allow_redirects=False)
    except requests.RequestException as error:
        network_error = type(error).__name__
    else:
        network_error = None
    if network_error is not None:
        # H4: la RequestException encadena una PreparedRequest con el Bearer.
        # Se lanza fuera del except (sin cause ni context) conservando solo el
        # nombre de la clase, para que el token no sea alcanzable desde la cadena.
        failure = GoogleDispatchUnknown('Resultado Google desconocido; no repetir.')
        failure.cause_class = network_error
        raise failure from None
    try:
        code = response.status_code
        # A1: taxonomía por código. 408/429 son transitorios (no terminal); 409,
        # 499, 3xx, 5xx y cualquier 2xx distinto de 200 son inciertos; el resto de
        # 4xx son rechazo determinista y terminal.
        if code in (408, 429):
            raise GoogleDispatchRejectedRetryable(
                'Google indicó un rechazo transitorio (408/429).')
        if (code in (409, 499) or code >= 500 or 200 < code < 300
                or 300 <= code < 400):
            raise GoogleDispatchUnknown('Resultado Google desconocido; no repetir.')
        if code != 200:
            # Q1 (oferta-motores): llevar código + motivo para distinguir 404-modelo-retirado
            # (disponibilidad → fallback) del resto de 4xx finales (terminal). Aditivo.
            raise GoogleDispatchRejectedFinal(
                'Google rechazó la petición multimedia.',
                status_code=code, reason=_rejection_reason(response))
        try:
            payload = response.json()
        except (ValueError, requests.RequestException) as error:
            raise GoogleDispatchUnknown('Google respondió sin recibo verificable.') from error
        # A2/3e: un 200 con parada de seguridad, o uno que acaba en STOP sin medios
        # (solo texto), es un rechazo determinista, no un resultado incierto.
        safety_reason = _safety_block(payload)
        if safety_reason is not None:
            raise GoogleDispatchSafetyBlocked(
                'Google rechazó el contenido por seguridad: ' + safety_reason)
        if _terminal_without_media(payload):
            raise GoogleDispatchEmptyResult(
                'Google terminó sin medios (final terminal, solo texto).')
        if isinstance(request, CloudTtsRequest):
            outputs = (cloud_tts_completed(payload),)
            state, operation = 'completed', None
        elif isinstance(request, ImageRequest):
            outputs = tuple(image_completed(payload, request.model))
            state, operation = 'completed', None
        elif isinstance(request, VoiceoverRequest):
            outputs = (voiceover_completed(payload),)
            state, operation = 'completed', None
        elif isinstance(request, MusicRequest):
            if _music_terminal_no_audio(payload):
                raise GoogleDispatchEmptyResult(
                    'Lyria terminó sin parte de audio (empty determinista).')
            outputs = (music_completed(payload),)
            state, operation = 'completed', None
        elif request.model.startswith('veo-'):
            outputs = ()
            _loc = re.search(r'/locations/([^/]+)/', urlsplit(request.endpoint).path)
            operation = veo_operation_name(
                project, request.model, payload,
                _loc.group(1) if _loc else 'us-central1')
            state = 'accepted'
        elif (isinstance(request, VideoRequest)
              and request.mode.endswith('_background')):
            outputs = ()
            operation = omni_interaction_id(payload)
            state = 'accepted'
        else:
            outputs = tuple(omni_completed(payload))
            state, operation = 'completed', None
        provider = ('google_cloud_tts' if isinstance(request, CloudTtsRequest)
                    else 'google_vertex_ai')
        receipt = _receipt(attempt_id, expected_request_sha256, state,
                           operation, outputs, payload, provider)
        return GoogleDispatchResult(attempt_id, expected_request_sha256, state,
                                    operation, outputs, receipt)
    except GoogleDispatchError:
        raise
    except Exception as error:
        # A4: tras el POST solo puede salir Result, Error o Unknown. Cualquier
        # excepción inesperada (payload malformado → AttributeError/KeyError/
        # TypeError/IndexError, o ValueError de los parsers) es INCERTIDUMBRE: el
        # POST ya salió y su efecto es desconocido. No es enmascarar un bug de otra
        # capa, es cerrar el único punto donde el efecto externo ya ocurrió.
        raise GoogleDispatchUnknown(
            'Google respondió con un resultado no verificable.') from error
    finally:
        response.close()
