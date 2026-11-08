"""Transporte GCS sin reenvío automático para recursos creativos aprobados.

La biblioteca/worker debe entregar un token Cloud válido y una StorageRequest
preparada para un bucket privado. Esta función no decide titularidad ni gasto.
"""

from base64 import b64encode
from hashlib import md5, sha256
from io import BytesIO
import json
import re
from urllib.parse import parse_qs, urlsplit
import requests

from .creative_bucket_readiness import bucket_metadata_endpoint, check_bucket
from .creative_storage_contracts import (ResumableStorageRequest, StorageObject,
                                         StorageRequest, StorageReceipt,
                                         StreamingStorageRequest,
                                         storage_download_request,
                                         storage_metadata_request,
                                         storage_receipt)


class StorageTransportError(Exception):
    """Error no recuperable en este intento de carga."""


class StorageTransportUnknown(StorageTransportError):
    """La carga puede haberse aplicado; el worker debe reconciliar más tarde."""


class StorageTransportConflict(StorageTransportError):
    """El nombre esperado existe con otros bytes o metadatos."""


_RANGE = re.compile(r'bytes=0-([0-9]+)\Z')


def require_private_bucket(bucket: str, expected_location: str, token: str,
                           session: requests.Session) -> None:
    """Verifica el bucket real antes de enviar bytes; nunca lo crea o modifica."""
    endpoint = bucket_metadata_endpoint(bucket)
    if not isinstance(token, str) or not token:
        raise ValueError('Autorización Cloud Storage ausente.')
    try:
        response = session.request('GET', endpoint,
                                   headers={'Authorization': 'Bearer ' + token},
                                   timeout=(10, 20), allow_redirects=False)
    except requests.RequestException as error:
        raise StorageTransportError('No se pudo verificar el bucket GCS.') from error
    try:
        if response.status_code != 200:
            raise StorageTransportError('Bucket GCS privado no verificable.')
        try:
            readiness = check_bucket(response.json(), bucket, expected_location)
        except (ValueError, requests.RequestException) as error:
            raise StorageTransportError('Metadatos del bucket GCS no verificables.') from error
        if not readiness.ready:
            raise StorageTransportError('El bucket GCS no cumple: ' + ', '.join(readiness.missing))
    finally:
        response.close()


def upload_once(request: StorageRequest, token: str,
                session: requests.Session, *,
                expected_location: str) -> StorageReceipt:
    """Hace un único POST; ante incertidumbre consulta metadatos, nunca reenvía."""
    if (not isinstance(request, StorageRequest)
            or not isinstance(request.expected, StorageObject)
            or request.method != 'POST'
            or request.body is None or not isinstance(token, str) or not token):
        raise ValueError('Carga GCS o autorización no válida.')
    bucket_metadata_endpoint(request.expected.bucket)
    expected_endpoint = (f'https://storage.googleapis.com/upload/storage/v1/b/'
                         f'{request.expected.bucket}/o'
                         '?uploadType=multipart&ifGenerationMatch=0')
    if (request.endpoint != expected_endpoint
            or not isinstance(request.body, bytes)
            or request.headers.get('Content-Length') != str(len(request.body))
            or not request.headers.get('Content-Type', '').startswith(
                'multipart/related; boundary=uonify-')):
        raise ValueError('Sobre de carga GCS no válido.')
    require_private_bucket(request.expected.bucket, expected_location, token, session)
    headers = {**request.headers, 'Authorization': 'Bearer ' + token}
    try:
        response = session.request('POST', request.endpoint, headers=headers,
                                   data=request.body, timeout=(10, 90),
                                   allow_redirects=False)
    except requests.RequestException:
        return _reconcile(request, token, session)
    try:
        if response.status_code in (200, 201):
            try:
                return storage_receipt(response.json(), request.expected)
            except (ValueError, requests.RequestException) as error:
                raise StorageTransportUnknown('GCS aceptó la carga, pero el recibo no es verificable.') from error
        if response.status_code in (401, 403):
            raise StorageTransportError('Permiso de Cloud Storage denegado o caducado.')
        # M1: 408/429 son transitorios; el objeto create-only pudo aterrizar o no.
        # Reconciliar por GET (no re-POST): si existe y casa → recibo idempotente;
        # si no → sigue incierto.
        if response.status_code in (408, 412, 429) or response.status_code >= 500:
            return _reconcile(request, token, session)
        raise StorageTransportError('Cloud Storage rechazó la carga.')
    finally:
        response.close()


def _resumable_metadata_envelope(request) -> None:
    if (not isinstance(request, (ResumableStorageRequest,
                                 StreamingStorageRequest))
            or not isinstance(request.expected, StorageObject)
            or request.method != 'POST'
            or request.chunk_bytes < 256 * 1024
            or request.chunk_bytes % (256 * 1024)
            or request.endpoint != (
                f'https://storage.googleapis.com/upload/storage/v1/b/'
                f'{request.expected.bucket}/o'
                '?uploadType=resumable&ifGenerationMatch=0')
            or request.headers.get('Content-Type')
            != 'application/json; charset=UTF-8'
            or request.headers.get('Content-Length') != str(len(request.metadata))
            or request.headers.get('X-Upload-Content-Type')
            != request.expected.mime_type
            or request.headers.get('X-Upload-Content-Length')
            != str(request.expected.byte_size)):
        raise ValueError('Sobre de carga reanudable GCS no válido.')
    try:
        metadata = json.loads(request.metadata)
    except (TypeError, ValueError, UnicodeDecodeError) as error:
        raise ValueError('Metadatos de carga reanudable no válidos.') from error
    if metadata != {
            'name': request.expected.name,
            'contentType': request.expected.mime_type,
            'md5Hash': request.expected.md5_base64,
            'cacheControl': 'private, no-store',
            'metadata': {'sha256': request.expected.sha256}}:
        raise ValueError('Metadatos de carga reanudable no válidos.')


def _resumable_envelope(request: ResumableStorageRequest) -> None:
    _resumable_metadata_envelope(request)
    if (not isinstance(request, ResumableStorageRequest) or not request.body
            or len(request.body) != request.expected.byte_size
            or sha256(request.body).hexdigest() != request.expected.sha256
            or b64encode(md5(request.body).digest()).decode('ascii')
            != request.expected.md5_base64):
        raise ValueError('Sobre de carga reanudable GCS no válido.')


def _stream_reader(request: StreamingStorageRequest, source):
    _resumable_metadata_envelope(request)
    if (not isinstance(request, StreamingStorageRequest)
            or not callable(getattr(source, 'read', None))
            or not callable(getattr(source, 'seek', None))
            or not source.readable() or not source.seekable()):
        raise ValueError('Stream de carga reanudable GCS no válido.')
    source.seek(0)
    size, digest, md5sum = 0, sha256(), md5()
    while chunk := source.read(min(request.chunk_bytes, 1024 * 1024)):
        size += len(chunk)
        if size > request.expected.byte_size:
            raise ValueError('Stream de carga reanudable GCS no válido.')
        digest.update(chunk)
        md5sum.update(chunk)
    if (size != request.expected.byte_size
            or digest.hexdigest() != request.expected.sha256
            or b64encode(md5sum.digest()).decode('ascii')
            != request.expected.md5_base64):
        raise ValueError('Stream de carga reanudable GCS no válido.')

    def read_at(start: int, stop: int) -> bytes:
        source.seek(start)
        chunk = source.read(stop - start)
        if not isinstance(chunk, bytes) or len(chunk) != stop - start:
            raise StorageTransportUnknown(
                'El stream cambió durante la carga reanudable.')
        return chunk
    return read_at


def _session_url(value: object, expected: StorageObject) -> str:
    if not isinstance(value, str) or len(value) > 4096:
        raise StorageTransportUnknown('GCS no devolvió una sesión reanudable verificable.')
    parsed = urlsplit(value)
    expected_path = f'/upload/storage/v1/b/{expected.bucket}/o'
    query = parse_qs(parsed.query, keep_blank_values=True)
    if (parsed.scheme != 'https' or parsed.netloc != 'storage.googleapis.com'
            or parsed.path != expected_path or parsed.fragment
            or set(query) != {'upload_id'} or len(query['upload_id']) != 1
            or not query['upload_id'][0]):
        raise StorageTransportUnknown('La sesión reanudable GCS no es confiable.')
    return value


def _committed(response, total: int) -> int:
    value = getattr(response, 'headers', {}).get('Range')
    if value is None:
        return 0
    match = _RANGE.fullmatch(value)
    if not match:
        raise StorageTransportUnknown('GCS devolvió un rango reanudable ilegible.')
    committed = int(match.group(1)) + 1
    if not 0 < committed <= total:
        raise StorageTransportUnknown('GCS devolvió un rango reanudable imposible.')
    return committed


def _query_resumable(session_url: str, request,
                     token: str, session: requests.Session
                     ) -> int | StorageReceipt:
    headers = {'Authorization': 'Bearer ' + token, 'Content-Length': '0',
               'Content-Range': f'bytes */{request.expected.byte_size}'}
    try:
        response = session.request('PUT', session_url, headers=headers, data=b'',
                                   timeout=(10, 30), allow_redirects=False)
    except requests.RequestException as error:
        raise StorageTransportUnknown(
            'No se pudo reconciliar la sesión reanudable GCS.') from error
    try:
        if response.status_code == 308:
            return _committed(response, request.expected.byte_size)
        if response.status_code in (200, 201):
            try:
                return storage_receipt(response.json(), request.expected)
            except (ValueError, requests.RequestException) as error:
                raise StorageTransportUnknown(
                    'GCS terminó la sesión, pero el recibo no es verificable.') from error
        raise StorageTransportUnknown('El estado de la sesión reanudable sigue incierto.')
    finally:
        response.close()


def _upload_resumable(request, token: str, session: requests.Session, *,
                      expected_location: str, read_at) -> StorageReceipt:
    if not isinstance(token, str) or not token:
        raise ValueError('Autorización Cloud Storage ausente.')
    require_private_bucket(request.expected.bucket, expected_location, token, session)
    headers = {**request.headers, 'Authorization': 'Bearer ' + token}
    try:
        initiated = session.request('POST', request.endpoint, headers=headers,
                                    data=request.metadata, timeout=(10, 30),
                                    allow_redirects=False)
    except requests.RequestException as error:
        raise StorageTransportUnknown(
            'No se pudo confirmar la creación de la sesión reanudable.') from error
    try:
        if initiated.status_code in (408, 412, 429):
            # M1: transitorios en el arranque de la sesión reanudable; reconciliar.
            return _reconcile(request, token, session)
        if initiated.status_code in (401, 403):
            raise StorageTransportError('Permiso de Cloud Storage denegado o caducado.')
        if initiated.status_code not in (200, 201):
            raise StorageTransportUnknown(
                'Cloud Storage no confirmó la sesión reanudable.')
        session_url = _session_url(
            getattr(initiated, 'headers', {}).get('Location'), request.expected)
    finally:
        initiated.close()

    total, offset, no_progress = request.expected.byte_size, 0, 0
    while offset < total:
        end = min(offset + request.chunk_bytes, total) - 1
        chunk = read_at(offset, end + 1)
        chunk_headers = {
            'Authorization': 'Bearer ' + token,
            'Content-Type': request.expected.mime_type,
            'Content-Length': str(len(chunk)),
            'Content-Range': f'bytes {offset}-{end}/{total}',
        }
        try:
            response = session.request('PUT', session_url, headers=chunk_headers,
                                       data=chunk, timeout=(10, 180),
                                       allow_redirects=False)
        except requests.RequestException:
            reconciled = _query_resumable(session_url, request, token, session)
            if isinstance(reconciled, StorageReceipt):
                return reconciled
            next_offset = reconciled
        else:
            try:
                if response.status_code == 308:
                    next_offset = _committed(response, total)
                elif response.status_code in (200, 201):
                    if end + 1 != total:
                        raise StorageTransportUnknown(
                            'GCS cerró la sesión antes del último fragmento.')
                    try:
                        return storage_receipt(response.json(), request.expected)
                    except (ValueError, requests.RequestException) as error:
                        raise StorageTransportUnknown(
                            'GCS aceptó los bytes, pero el recibo no es verificable.') from error
                elif response.status_code in (401, 403):
                    raise StorageTransportUnknown(
                        'La autorización caducó durante una carga parcialmente aplicada.')
                else:
                    reconciled = _query_resumable(
                        session_url, request, token, session)
                    if isinstance(reconciled, StorageReceipt):
                        return reconciled
                    next_offset = reconciled
            finally:
                response.close()
        if next_offset < offset or next_offset > end + 1:
            raise StorageTransportUnknown('El offset GCS no coincide con el fragmento.')
        no_progress = no_progress + 1 if next_offset == offset else 0
        if no_progress > 2:
            raise StorageTransportUnknown('La sesión GCS no confirma progreso.')
        offset = next_offset
    raise StorageTransportUnknown('La sesión terminó sin recibo final verificable.')


def upload_resumable_once(request: ResumableStorageRequest, token: str,
                          session: requests.Session, *,
                          expected_location: str) -> StorageReceipt:
    """Sube bytes por fragmentos y consulta el offset antes de repetirlos."""
    _resumable_envelope(request)
    return _upload_resumable(
        request, token, session, expected_location=expected_location,
        read_at=lambda start, stop: request.body[start:stop])


def upload_streaming_resumable_once(
        request: StreamingStorageRequest, source, token: str,
        session: requests.Session, *, expected_location: str) -> StorageReceipt:
    """Sube un stream verificado y reanudable sin retener el objeto completo."""
    read_at = _stream_reader(request, source)
    return _upload_resumable(
        request, token, session, expected_location=expected_location,
        read_at=read_at)


def _reconcile(upload: StorageRequest | ResumableStorageRequest
               | StreamingStorageRequest, token: str,
               session: requests.Session) -> StorageReceipt:
    read = storage_metadata_request(upload.expected)
    try:
        response = session.request('GET', read.endpoint,
                                   headers={'Authorization': 'Bearer ' + token},
                                   timeout=(10, 20), allow_redirects=False)
    except requests.RequestException as error:
        raise StorageTransportUnknown('No se pudo reconciliar la carga GCS.') from error
    try:
        if response.status_code == 404 or response.status_code >= 500:
            raise StorageTransportUnknown('El estado de la carga GCS sigue incierto.')
        if response.status_code in (401, 403):
            raise StorageTransportUnknown('No se pudo verificar la carga GCS por permisos.')
        if response.status_code != 200:
            raise StorageTransportUnknown('No se pudo verificar el estado de la carga GCS.')
        try:
            return storage_receipt(response.json(), upload.expected)
        except (ValueError, requests.RequestException) as error:
            raise StorageTransportConflict('El objeto GCS existente no coincide.') from error
    finally:
        response.close()


def download_verified_to(receipt: StorageReceipt, token: str,
                         session: requests.Session, sink) -> int:
    """Descarga una generación fija a un sink sin acumular el medio en memoria."""
    if not isinstance(token, str) or not token:
        raise ValueError('Autorización Cloud Storage ausente.')
    if not callable(getattr(sink, 'write', None)):
        raise ValueError('Destino de descarga privada no válido.')
    request = storage_download_request(receipt)
    try:
        response = session.request('GET', request.endpoint,
                                   headers={'Authorization': 'Bearer ' + token},
                                   timeout=(10, 90), stream=True, allow_redirects=False)
        if response.status_code != 200:
            raise StorageTransportError('No se pudo descargar el recurso GCS.')
        count, digest = 0, sha256()
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            count += len(chunk)
            if count > receipt.byte_size:
                raise StorageTransportConflict('El recurso GCS excede su tamaño aprobado.')
            digest.update(chunk)
            written = sink.write(chunk)
            if written not in (None, len(chunk)):
                raise StorageTransportConflict(
                    'El destino no conservó todos los bytes verificados.')
        if count != receipt.byte_size or digest.hexdigest() != receipt.sha256:
            raise StorageTransportConflict('Los bytes GCS no coinciden con el recibo.')
        return count
    except requests.RequestException as error:
        raise StorageTransportUnknown('Descarga GCS interrumpida.') from error
    finally:
        if 'response' in locals():
            response.close()


def download_verified(receipt: StorageReceipt, token: str,
                      session: requests.Session) -> bytes:
    """Compatibilidad para recursos que el caller necesita conservar en memoria."""
    sink = BytesIO()
    download_verified_to(receipt, token, session, sink)
    return sink.getvalue()
