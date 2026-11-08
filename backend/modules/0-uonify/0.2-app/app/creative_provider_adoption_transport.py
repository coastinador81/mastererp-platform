"""Transporte GCS rewrite sin repetición automática tras resultado incierto."""

from dataclasses import dataclass
import re
from urllib.parse import quote

import requests

from .creative_provider_asset_adoption import (
    ProviderAdoptionRequest, provider_video_adoption_response,
    validate_provider_video_adoption_request)
from .creative_google_staging_adoption import (
    GoogleStagingAdoptionRequest, google_staging_adoption_response,
    validate_google_staging_adoption_request)
from .creative_storage_contracts import StorageReceipt
from .creative_storage_transport import require_private_bucket


class ProviderAdoptionTransportError(Exception):
    """La adopción fue rechazada o no es verificable."""


class ProviderAdoptionTransportUnknown(ProviderAdoptionTransportError):
    """El rewrite puede haberse aplicado; no se debe repetir automáticamente."""


class ProviderAdoptionTransportConflict(ProviderAdoptionTransportError):
    """El destino existe pero no coincide con el asset esperado."""


AdoptionRequest = ProviderAdoptionRequest | GoogleStagingAdoptionRequest


# F9(e)/29j: identificadores card-safe del cuerpo de error GCS. `reason` (enum: invalid/required/
# forbidden/conditionNotMet/notFound…), `location` (NOMBRE del campo inválido: name, cacheControl,
# sourceGeneration, metadata.sha256…) y `locationType` (data=body / parameter=query / header). Los tres
# pasan la compuerta estricta _GCS_IDENT (RECHAZA '/', ':', '-', espacio → gs://, bucket, uuid, project-id
# NO casan). NUNCA se lee `error.message` para el ledger/log: ecoa gs://+uuid.
_GCS_IDENT = re.compile(r'[A-Za-z][A-Za-z0-9_.]{0,39}')


def _gcs_error_fields(response) -> tuple[str | None, str | None, str | None]:
    """F9(e)/29j: extrae `errors[0].reason`, `errors[0].location` y `errors[0].locationType` del cuerpo
    de error GCS — los tres son IDENTIFICADORES card-safe. NO lee `message` (prohibido en el ledger: ecoa
    la ruta del objeto). `locationType` desambigua body(data) vs query(parameter) para el caso `name`.
    Sólo lectura. Devuelve (reason|None, location|None, locationType|None); None si no parseable o no casa."""
    try:
        payload = response.json()
    except (ValueError, requests.RequestException):
        return None, None, None
    error = payload.get('error') if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return None, None, None
    errors = error.get('errors')
    first = (errors[0] if isinstance(errors, list) and errors
             and isinstance(errors[0], dict) else {})

    def _ident(value):
        return (value if isinstance(value, str)
                and _GCS_IDENT.fullmatch(value) else None)

    return (_ident(first.get('reason')), _ident(first.get('location')),
            _ident(first.get('locationType')))


def _metadata_url(request: AdoptionRequest) -> str:
    expected = request.draft.expected
    return (f'https://storage.googleapis.com/storage/v1/b/{expected.bucket}/o/'
            f'{quote(expected.name, safe="")}')


def _existing_receipt(request: AdoptionRequest,
                      metadata: dict) -> StorageReceipt:
    expected = request.draft.expected
    try:
        generation = int(metadata.get('generation', ''))
        size = int(metadata.get('size', ''))
    except (AttributeError, TypeError, ValueError):
        raise ProviderAdoptionTransportConflict(
            'El destino GCS existente no tiene metadatos válidos.') from None
    custom = metadata.get('metadata')
    if (metadata.get('bucket') != expected.bucket
            or metadata.get('name') != expected.name
            or metadata.get('contentType') != expected.mime_type
            or generation <= 0 or size != expected.byte_size
            or not isinstance(custom, dict)
            or custom.get('sha256') != expected.sha256):
        raise ProviderAdoptionTransportConflict(
            'El destino GCS existente no coincide con el asset.')
    return StorageReceipt(expected.bucket, expected.name, generation,
                          expected.mime_type, size, expected.sha256)


def _reconcile(request: AdoptionRequest, token: str,
               session: requests.Session, *, verify=_existing_receipt) -> StorageReceipt:
    try:
        response = session.request(
            'GET', _metadata_url(request),
            headers={'Authorization': 'Bearer ' + token}, timeout=(10, 20),
            allow_redirects=False)
    except requests.RequestException as error:
        network_error = type(error).__name__
    else:
        network_error = None
    if network_error is not None:
        # H4: no encadenar la RequestException (lleva el Bearer en .request);
        # se relanza fuera del except conservando solo el nombre de la clase.
        failure = ProviderAdoptionTransportUnknown(
            'No se pudo reconciliar el rewrite GCS.')
        failure.cause_class = network_error
        raise failure from None
    try:
        if response.status_code == 404 or response.status_code >= 500:
            raise ProviderAdoptionTransportUnknown(
                'El resultado del rewrite GCS sigue incierto.')
        if response.status_code in (401, 403):
            raise ProviderAdoptionTransportUnknown(
                'No se pudo reconciliar el rewrite por permisos.')
        if response.status_code != 200:
            raise ProviderAdoptionTransportUnknown(
                'No se pudo verificar el destino del rewrite.')
        try:
            return verify(request, response.json())
        except requests.RequestException as error:
            raise ProviderAdoptionTransportUnknown(
                'La respuesta de reconciliación no es legible.') from error
    finally:
        response.close()


def _adopt_once(request, token: str, session: requests.Session, *,
                expected_location: str, validate, parse,
                reconcile_verify=_existing_receipt, handle_done: bool = False,
                max_rewrite: int = 4):
    """Núcleo generalizado: un POST (más continuaciones por rewriteToken si
    `handle_done`) con validación, parseo y verificación de reconciliación
    inyectables. Las rutas Google conservan su comportamiento exacto pasando sus
    propios validate/parse y los valores por defecto (sin bucle done, verify actual)."""
    if not isinstance(token, str) or not token:
        raise ValueError('Rewrite o autorización GCS no válidos.')
    validate(request)
    require_private_bucket(request.draft.expected.bucket, expected_location,
                           token, session)
    headers = {'Authorization': 'Bearer ' + token,
               'Content-Type': 'application/json'}
    # El body se mantiene IDÉNTICO entre llamadas; la continuación va en la QUERY
    # (objects.rewrite: rewriteToken es query param, no body). Poner el token en el
    # body reiniciaría el rewrite y nunca llegaría a done=true.
    url = request.endpoint
    for attempt in range(max_rewrite + 1):
        try:
            response = session.request('POST', url, headers=headers,
                                       json=request.body, timeout=(10, 90),
                                       allow_redirects=False)
        except requests.RequestException:
            return _reconcile(request, token, session, verify=reconcile_verify)
        try:
            code = response.status_code
            if code == 200:
                try:
                    payload = response.json()
                except (ValueError, requests.RequestException) as error:
                    raise ProviderAdoptionTransportUnknown(
                        'GCS respondió al rewrite, pero el progreso no es verificable.') from error
                # Condición 3: done=false nunca se da por terminado; se continúa con
                # &rewriteToken=<token> en la query (mismo endpoint, mismo body) dentro
                # de un tope de iteraciones, o se falla controlado.
                if handle_done and isinstance(payload, dict) and payload.get('done') is False:
                    rewrite_token = payload.get('rewriteToken')
                    if (not isinstance(rewrite_token, str) or not rewrite_token
                            or attempt >= max_rewrite):
                        raise ProviderAdoptionTransportUnknown(
                            'El rewrite GCS no terminó en el plazo (done=false).')
                    url = request.endpoint + '&rewriteToken=' + quote(
                        rewrite_token, safe='')
                    continue
                try:
                    return parse(request, payload)
                except (ValueError, requests.RequestException) as error:
                    raise ProviderAdoptionTransportUnknown(
                        'GCS respondió al rewrite, pero el progreso no es verificable.') from error
            if code in (401, 403):
                # F9(e): discriminador D-PROTECCIÓN-safe (code int + errors[0].reason enum; message
                # saneado a log interno vía el runner) para nombrar el rechazo sin re-drive a ciegas.
                failure = ProviderAdoptionTransportError(
                    'Permiso de Cloud Storage denegado o caducado.')
                failure.http_status = code
                (failure.gcs_reason, failure.gcs_location,
                 failure.gcs_location_type) = _gcs_error_fields(response)
                raise failure
            if code in (408, 412, 429) or code >= 500:
                # H12 (regla M1): 408/429 (como 412 y 5xx) son INCIERTOS → reconciliar
                # por GET, nunca terminar; sólo el resto de 4xx es rechazo determinista.
                return _reconcile(request, token, session, verify=reconcile_verify)
            failure = ProviderAdoptionTransportError('Cloud Storage rechazó el rewrite.')
            failure.http_status = code
            (failure.gcs_reason, failure.gcs_location,
             failure.gcs_location_type) = _gcs_error_fields(response)
            raise failure
        finally:
            response.close()
    raise ProviderAdoptionTransportUnknown(
        'El rewrite GCS no terminó en el plazo (done=false).')


def adopt_provider_video_once(
        request: ProviderAdoptionRequest, token: str,
        session: requests.Session, *, expected_location: str,
        ) -> ProviderAdoptionRequest | StorageReceipt:
    """Ejecuta como máximo un POST; una continuación requiere otro claim."""
    if not isinstance(request, ProviderAdoptionRequest):
        raise ValueError('Rewrite o autorización GCS no válidos.')
    return _adopt_once(
        request, token, session, expected_location=expected_location,
        validate=validate_provider_video_adoption_request,
        parse=provider_video_adoption_response)


def _source_gcs_checksums(source: StorageReceipt, token: str,
                          session: requests.Session) -> dict:
    """H7: lee crc32c/md5Hash que CALCULA GCS del objeto de ORIGEN (generación fija).
    El GET lleva Bearer: si falla la red, se relanza FUERA del except conservando solo
    el nombre de la clase (H4), sin dejar el token en la cadena."""
    if not isinstance(token, str) or not token:
        raise ValueError('Rewrite o autorización GCS no válidos.')
    url = (f'https://storage.googleapis.com/storage/v1/b/{source.bucket}/o/'
           f'{quote(source.name, safe="")}?generation={source.generation}'
           f'&fields=crc32c,md5Hash')
    network_error = None
    response = None
    try:
        response = session.request(
            'GET', url, headers={'Authorization': 'Bearer ' + token},
            timeout=(10, 30), allow_redirects=False)
    except requests.RequestException as error:
        network_error = type(error).__name__
    if network_error is not None:
        failure = ProviderAdoptionTransportUnknown(
            'No se pudo leer el checksum del origen GCS.')
        failure.cause_class = network_error
        raise failure from None
    try:
        if response.status_code != 200:
            raise ProviderAdoptionTransportUnknown(
                'El origen GCS no devolvió checksum verificable.')
        try:
            payload = response.json()
        except (ValueError, requests.RequestException):
            raise ProviderAdoptionTransportUnknown(
                'El checksum del origen GCS no es legible.') from None
    finally:
        if response is not None:
            response.close()
    crc = payload.get('crc32c') if isinstance(payload, dict) else None
    if not isinstance(crc, str) or not crc:
        raise ProviderAdoptionTransportUnknown(
            'El origen GCS no trae crc32c comparable.')
    md5 = payload.get('md5Hash')
    return {'crc32c': crc, 'md5Hash': md5 if isinstance(md5, str) else None}


def _require_gcs_byte_preservation(destination, source: dict) -> None:
    """H7: el DESTINO debe conservar los bytes del ORIGEN según los checksums que
    CALCULA GCS: crc32c SIEMPRE y md5Hash cuando ambos lo traigan. Un desajuste es un
    rechazo (Conflict); la falta de checksum comparable falla cerrado (Unknown)."""
    if not isinstance(destination, dict):
        raise ProviderAdoptionTransportUnknown(
            'El destino GCS no trae checksum comparable.')
    dest_crc = destination.get('crc32c')
    if not isinstance(dest_crc, str) or not dest_crc:
        raise ProviderAdoptionTransportUnknown(
            'El destino GCS no trae crc32c comparable.')
    if dest_crc != source['crc32c']:
        raise ProviderAdoptionTransportConflict(
            'El crc32c del destino no coincide con el del origen.')
    dest_md5, source_md5 = destination.get('md5Hash'), source['md5Hash']
    if (isinstance(dest_md5, str) and isinstance(source_md5, str)
            and dest_md5 != source_md5):
        raise ProviderAdoptionTransportConflict(
            'El md5Hash del destino no coincide con el del origen.')


def adopt_google_staging_once(
        request: GoogleStagingAdoptionRequest, token: str,
        session: requests.Session, *, expected_location: str,
        ) -> GoogleStagingAdoptionRequest | StorageReceipt:
    """Reescribe un medio staging con un POST máximo y reconciliación GET.

    H7: valida antes de tocar la red; lee los checksums que CALCULA GCS del ORIGEN
    (un GET extra) y verifica, en el DESTINO (resource del rewrite o metadata de la
    reconciliación), que crc32c (siempre) y md5Hash (si ambos lo traen) coinciden con el
    origen, además del sha256 de custom metadata. El endpoint lleva
    ifSourceGenerationMatch: si el origen cambió de generación, GCS devuelve 412 y
    _adopt_once reconcilia (M1/H12), nunca lo da por bueno."""
    if not isinstance(request, GoogleStagingAdoptionRequest):
        raise ValueError('Rewrite Google o autorización GCS no válidos.')
    validate_google_staging_adoption_request(request)
    source = _source_gcs_checksums(request.source, token, session)

    def parse(adoption, payload):
        receipt = google_staging_adoption_response(adoption, payload)
        if isinstance(receipt, StorageReceipt):
            _require_gcs_byte_preservation(
                payload.get('resource') if isinstance(payload, dict) else None,
                source)
        return receipt

    def verify(adoption, metadata):
        receipt = _existing_receipt(adoption, metadata)
        _require_gcs_byte_preservation(metadata, source)
        return receipt

    return _adopt_once(
        request, token, session, expected_location=expected_location,
        validate=validate_google_staging_adoption_request, parse=parse,
        reconcile_verify=verify)


# --- Primitivo neutral de transporte rewrite create-only (namespace-agnóstico) ---
# Reutiliza el núcleo _adopt_once/_reconcile y la taxonomía; la verificación es por
# md5/size que calcula GCS (no solo el sha256 declarado). APROBADO CON CONDICIONES.

_CONTROL = re.compile(r'[\x00-\x1f]')
_ALLOWED_META_KEYS = frozenset({'sha256'})
_UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')

# Tabla CERRADA de flujos: el servidor deriva los prefijos del owner verificado; el
# llamador NO pasa prefijos como texto libre. Así origen y destino van siempre atados
# al MISMO tenant (owner) y no se puede escribir en el espacio de otro cliente.
# Tabla cerrada de flows. 'craft' NO tiene fila propia a propósito (veredicto del
# Consultor Google 2026-10-21): las generaciones Craft corren por el envelope Google
# y su staging ES creative/staging/google/{owner}/, así que la adopción Craft usa
# flow='google'. La procedencia craft-vs-google se registra en el ledger/manifiesto
# del intento, no en el prefijo. Una fila que ningún código produce sería configuración
# muerta. Si algún día Craft necesita su propio staging, se añade con veredicto y con
# el código que lo escriba.
_FLOW_PREFIXES = {
    'google': {'source': 'creative/staging/google/{owner}/',
               'dest': 'creative/users/{owner}/assets/'},
}


@dataclass(frozen=True)
class _RewriteExpected:
    bucket: str
    name: str
    mime_type: str
    byte_size: int
    sha256: str
    md5_base64: str | None
    crc32c: str | None


@dataclass(frozen=True)
class _RewriteDraft:
    expected: _RewriteExpected


@dataclass(frozen=True)
class _RewriteRequest:
    endpoint: str
    body: dict
    draft: _RewriteDraft
    source: StorageReceipt
    source_prefix: str
    dest_prefix: str
    allowed_buckets: tuple


def _validate_rewrite_request(request: _RewriteRequest) -> None:
    """Condiciones 4 y 5: barrera por prefijos SEPARADOS (origen/destino) atados al
    owner, metadatos de lista cerrada, bucket en allowlist. Sin «..»/«//»/control."""
    if not isinstance(request, _RewriteRequest):
        raise ValueError('Petición de rewrite neutra no válida.')
    exp, src = request.draft.expected, request.source
    if not isinstance(src, StorageReceipt) or src.generation <= 0:
        raise ValueError('Origen de rewrite no verificable.')
    for name, prefix in ((src.name, request.source_prefix),
                         (exp.name, request.dest_prefix)):
        if (not isinstance(name, str) or not name.startswith(prefix)
                or '..' in name or '//' in name or _CONTROL.search(name)):
            raise ValueError('Nombre fuera de su prefijo permitido o inseguro.')
    if (src.bucket not in request.allowed_buckets
            or exp.bucket not in request.allowed_buckets):
        raise ValueError('Bucket no permitido.')
    meta = request.body.get('metadata')
    if not isinstance(meta, dict) or set(meta) - _ALLOWED_META_KEYS:
        raise ValueError('Metadatos fuera de la lista cerrada.')
    if meta.get('sha256') != exp.sha256:
        raise ValueError('sha256 de metadatos no coincide con el esperado.')
    if exp.md5_base64 is None and exp.crc32c is None:
        raise ValueError('expected debe traer md5_base64 o crc32c.')


def _verify_dest_metadata(request: _RewriteRequest, metadata) -> StorageReceipt:
    """Condición 2+3: integridad por lo que CALCULA GCS. md5Hash si viene; si no
    (objeto compuesto), crc32c; si no viene ninguno verificable contra lo esperado,
    es Unknown (nunca éxito)."""
    exp = request.draft.expected
    if not isinstance(metadata, dict):
        raise ProviderAdoptionTransportConflict('El destino GCS no tiene metadatos.')
    try:
        generation = int(metadata.get('generation', ''))
        size = int(metadata.get('size', ''))
    except (TypeError, ValueError):
        raise ProviderAdoptionTransportConflict(
            'El destino GCS no tiene metadatos válidos.') from None
    custom = metadata.get('metadata')
    if (metadata.get('bucket') != exp.bucket or metadata.get('name') != exp.name
            or metadata.get('contentType') != exp.mime_type
            or generation <= 0 or size != exp.byte_size
            or not isinstance(custom, dict) or custom.get('sha256') != exp.sha256):
        raise ProviderAdoptionTransportConflict(
            'El destino GCS no coincide (ruta/tamaño/sha256).')
    if metadata.get('md5Hash') is not None and exp.md5_base64 is not None:
        if metadata['md5Hash'] != exp.md5_base64:
            raise ProviderAdoptionTransportConflict('El md5 del destino no coincide.')
    elif metadata.get('crc32c') is not None and exp.crc32c is not None:
        if metadata['crc32c'] != exp.crc32c:
            raise ProviderAdoptionTransportConflict('El crc32c del destino no coincide.')
    else:
        raise ProviderAdoptionTransportUnknown(
            'El destino GCS no trae un hash verificable contra lo esperado.')
    return StorageReceipt(exp.bucket, exp.name, generation, exp.mime_type,
                          size, exp.sha256)


def _verify_rewrite_resource(request: _RewriteRequest, payload) -> StorageReceipt:
    resource = payload.get('resource') if isinstance(payload, dict) else None
    return _verify_dest_metadata(request, resource)


def rewrite_create_only(
        session: requests.Session, token: str, *, source: StorageReceipt,
        owner_user_id: str, flow: str, dest_bucket: str, dest_name: str,
        expected: dict, allowed_buckets, expected_location: str) -> StorageReceipt:
    """Rewrite GCS create-only neutral. Los prefijos de origen y destino los DERIVA
    el servidor de (`flow`, `owner_user_id`) por una tabla cerrada; el llamador no
    pasa prefijos de texto libre (barrera anti cruce de tenant). Un POST (+continuación
    por rewriteToken si done=false, con tope) con ifSourceGenerationMatch e
    ifGenerationMatch=0; verificación por md5Hash o crc32c que calcula GCS.
    `expected` = {mime_type, byte_size, sha256, md5_base64?, crc32c?} (al menos uno de
    md5_base64/crc32c). `allowed_buckets` lo fija el llamador."""
    if not isinstance(owner_user_id, str) or not _UUID.fullmatch(owner_user_id.lower()):
        raise ValueError('owner_user_id no es un UUID válido.')
    if flow not in _FLOW_PREFIXES:
        raise ValueError('Flujo de rewrite no permitido.')
    tmpl = _FLOW_PREFIXES[flow]
    source_prefix = tmpl['source'].format(owner=owner_user_id)
    dest_prefix = tmpl['dest'].format(owner=owner_user_id)
    exp = _RewriteExpected(
        dest_bucket, dest_name, expected['mime_type'], int(expected['byte_size']),
        expected['sha256'], expected.get('md5_base64'), expected.get('crc32c'))
    endpoint = (
        f'https://storage.googleapis.com/storage/v1/b/{source.bucket}/o/'
        f'{quote(source.name, safe="")}/rewriteTo/b/{dest_bucket}/o/'
        f'{quote(dest_name, safe="")}'
        f'?sourceGeneration={source.generation}'
        f'&ifSourceGenerationMatch={source.generation}'
        f'&ifGenerationMatch=0')
    # F9(e): el nombre del destino va en la URL (rewriteTo/.../o/<dest_name>); incluir `name` en el
    # body dispara 400 INVALID_ARGUMENT en objects.rewrite. Body = solo metadata del destino.
    body = {'contentType': exp.mime_type,
            'cacheControl': 'private, no-store', 'metadata': {'sha256': exp.sha256}}
    request = _RewriteRequest(endpoint, body, _RewriteDraft(exp), source,
                              source_prefix, dest_prefix, tuple(allowed_buckets))
    return _adopt_once(
        request, token, session, expected_location=expected_location,
        validate=_validate_rewrite_request, parse=_verify_rewrite_resource,
        reconcile_verify=_verify_dest_metadata, handle_done=True)
