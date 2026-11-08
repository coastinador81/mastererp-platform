"""Peticiones GCS privadas y sin transporte para conservar recursos creativos.

No crea buckets ni envía HTTP. El caller debe usar un bucket privado verificado,
un token autorizado y persistir el recibo junto con la titularidad del asset.
"""

from base64 import b64decode, b64encode
from dataclasses import dataclass
from hashlib import md5, sha256
from io import BytesIO
import json
import re
from secrets import token_hex
from urllib.parse import quote
from uuid import UUID
import wave

from .creative_music_contracts import _has_mp3_frame
from .creative_video_contracts import mp4_duration_seconds


_BUCKET = re.compile(r'[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]\Z')
_EXTENSIONS = {
    'video/mp4': 'mp4', 'image/png': 'png', 'image/jpeg': 'jpg',
    'image/webp': 'webp', 'audio/mpeg': 'mp3',
    'audio/L16;codec=pcm;rate=24000': 'pcm',
    'audio/wav': 'wav', 'application/zip': 'zip',
}
_MAX_MULTIPART_BYTES = 20_000_000
_MAX_STORAGE_BYTES = 250_000_000
_RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class StorageObject:
    bucket: str
    name: str
    mime_type: str
    byte_size: int
    sha256: str
    md5_base64: str


@dataclass(frozen=True)
class StorageRequest:
    method: str
    endpoint: str
    headers: dict[str, str]
    body: bytes | None
    expected: StorageObject


@dataclass(frozen=True)
class ResumableStorageRequest:
    method: str
    endpoint: str
    headers: dict[str, str]
    metadata: bytes
    body: bytes
    chunk_bytes: int
    expected: StorageObject


@dataclass(frozen=True)
class StreamingStorageRequest:
    """Resumable upload metadata; bytes stay in the caller's bounded stream."""
    method: str
    endpoint: str
    headers: dict[str, str]
    metadata: bytes
    chunk_bytes: int
    expected: StorageObject


@dataclass(frozen=True)
class StorageReceipt:
    bucket: str
    name: str
    generation: int
    mime_type: str
    byte_size: int
    sha256: str


@dataclass(frozen=True)
class StorageFetchRequest:
    endpoint: str
    expected: StorageReceipt


def _uuid(value: str, label: str) -> str:
    try:
        identifier = UUID(value)
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError(f'{label} debe ser UUID.') from error
    return str(identifier)


def _bucket(value: str) -> str:
    if (not isinstance(value, str) or not _BUCKET.fullmatch(value)
            or '..' in value or value.startswith('goog') or value.startswith('g00g')):
        raise ValueError('Bucket GCS no válido.')
    return value


def _media(mime_type: str, data: bytes) -> None:
    if mime_type not in _EXTENSIONS or not isinstance(data, bytes) or not data:
        raise ValueError('Medio creativo no admitido.')
    if len(data) > _MAX_STORAGE_BYTES:
        raise ValueError('El recurso supera el límite privado de almacenamiento.')
    if mime_type == 'video/mp4':
        mp4_duration_seconds(data)
    elif mime_type == 'image/png' and not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Firma PNG incorrecta.')
    elif mime_type == 'image/jpeg' and not data.startswith(b'\xff\xd8\xff'):
        raise ValueError('Firma JPEG incorrecta.')
    elif mime_type == 'image/webp' and not (
            data.startswith(b'RIFF') and data[8:12] == b'WEBP'):
        raise ValueError('Firma WebP incorrecta.')
    elif mime_type == 'audio/mpeg' and not _has_mp3_frame(data):
        raise ValueError('Firma MP3 incorrecta.')
    elif mime_type == 'audio/L16;codec=pcm;rate=24000' and len(data) % 2:
        raise ValueError('Muestra PCM incompleta.')
    elif mime_type == 'audio/wav':
        try:
            with wave.open(BytesIO(data), 'rb') as wav:
                if wav.getnframes() <= 0 or wav.getcomptype() != 'NONE':
                    raise ValueError('WAV sin muestras PCM utilizables.')
        except (EOFError, wave.Error) as error:
            raise ValueError('WAV incorrecto.') from error
    elif mime_type == 'application/zip' and not data.startswith(b'PK\x03\x04'):
        raise ValueError('Firma ZIP incorrecta.')


def storage_stream_upload(bucket: str, user_id: str, asset_id: str,
                          mime_type: str, byte_size: int, digest: str,
                          md5_base64: str) -> StreamingStorageRequest:
    """Create-only resumable spec for bytes already validated as a stream."""
    bucket = _bucket(bucket)
    user_id, asset_id = _uuid(user_id, 'Usuario'), _uuid(asset_id, 'Asset')
    try:
        decoded_md5 = b64decode(md5_base64, validate=True)
    except (TypeError, ValueError):
        decoded_md5 = b''
    if (mime_type not in _EXTENSIONS
            or not isinstance(byte_size, int) or isinstance(byte_size, bool)
            or not 0 < byte_size <= _MAX_STORAGE_BYTES
            or not isinstance(digest, str)
            or not re.fullmatch(r'[0-9a-f]{64}', digest)
            or len(decoded_md5) != 16):
        raise ValueError('Prueba del stream creativo no válida.')
    name = (f'creative/users/{user_id}/assets/{asset_id}/'
            f'{digest}.{_EXTENSIONS[mime_type]}')
    expected = StorageObject(
        bucket, name, mime_type, byte_size, digest, md5_base64)
    metadata = {'name': name, 'contentType': mime_type, 'md5Hash': md5_base64,
                'cacheControl': 'private, no-store',
                'metadata': {'sha256': digest}}
    metadata_body = json.dumps(metadata, separators=(',', ':')).encode()
    endpoint = (f'https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o'
                '?uploadType=resumable&ifGenerationMatch=0')
    return StreamingStorageRequest(
        'POST', endpoint,
        {'Content-Type': 'application/json; charset=UTF-8',
         'Content-Length': str(len(metadata_body)),
         'X-Upload-Content-Type': mime_type,
         'X-Upload-Content-Length': str(byte_size)},
        metadata_body, _RESUMABLE_CHUNK_BYTES, expected)


def storage_upload(bucket: str, user_id: str, asset_id: str,
                   mime_type: str, data: bytes
                   ) -> StorageRequest | ResumableStorageRequest:
    """Create-only multipart o resumable según el tamaño de los bytes."""
    bucket = _bucket(bucket)
    user_id, asset_id = _uuid(user_id, 'Usuario'), _uuid(asset_id, 'Asset')
    _media(mime_type, data)
    digest = sha256(data).hexdigest()
    name = (f'creative/users/{user_id}/assets/{asset_id}/'
            f'{digest}.{_EXTENSIONS[mime_type]}')
    md5_base64 = b64encode(md5(data).digest()).decode('ascii')
    expected = StorageObject(bucket, name, mime_type, len(data), digest, md5_base64)
    metadata = {'name': name, 'contentType': mime_type, 'md5Hash': md5_base64,
                'cacheControl': 'private, no-store', 'metadata': {'sha256': digest}}
    if len(data) > _MAX_MULTIPART_BYTES:
        metadata_body = json.dumps(metadata, separators=(',', ':')).encode()
        endpoint = (f'https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o'
                    '?uploadType=resumable&ifGenerationMatch=0')
        return ResumableStorageRequest(
            'POST', endpoint,
            {'Content-Type': 'application/json; charset=UTF-8',
             'Content-Length': str(len(metadata_body)),
             'X-Upload-Content-Type': mime_type,
             'X-Upload-Content-Length': str(len(data))},
            metadata_body, data, _RESUMABLE_CHUNK_BYTES, expected)
    boundary = 'uonify-' + token_hex(16)
    body = (f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'
            .encode() + json.dumps(metadata, separators=(',', ':')).encode() +
            f'\r\n--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n'.encode() +
            data + f'\r\n--{boundary}--\r\n'.encode())
    endpoint = (f'https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o'
                '?uploadType=multipart&ifGenerationMatch=0')
    return StorageRequest('POST', endpoint,
                          {'Content-Type': f'multipart/related; boundary={boundary}',
                           'Content-Length': str(len(body))}, body, expected)


def storage_metadata_request(expected: StorageObject) -> StorageRequest:
    """Reconciliación de un upload incierto o 412; nunca reenvía bytes."""
    if not isinstance(expected, StorageObject):
        raise ValueError('Objeto GCS esperado no válido.')
    encoded = quote(expected.name, safe='')
    endpoint = (f'https://storage.googleapis.com/storage/v1/b/{_bucket(expected.bucket)}'
                f'/o/{encoded}')
    return StorageRequest('GET', endpoint, {}, None, expected)


def storage_receipt(response: dict, expected: StorageObject) -> StorageReceipt:
    """Acepta solo metadatos del mismo objeto/bytes; no interpreta un 412 como éxito."""
    if not isinstance(response, dict) or not isinstance(expected, StorageObject):
        raise ValueError('Respuesta GCS no válida.')
    try:
        size = int(response.get('size', ''))
        generation = int(response.get('generation', ''))
    except (TypeError, ValueError) as error:
        raise ValueError('Tamaño o generación GCS no válidos.') from error
    meta = response.get('metadata')
    if (response.get('bucket') != expected.bucket
            or response.get('name') != expected.name
            or response.get('contentType') != expected.mime_type
            or size != expected.byte_size or generation <= 0
            or response.get('md5Hash') != expected.md5_base64
            or not isinstance(meta, dict) or meta.get('sha256') != expected.sha256):
        raise ValueError('El objeto GCS no coincide con el recurso previsto.')
    return StorageReceipt(expected.bucket, expected.name, generation,
                          expected.mime_type, size, expected.sha256)


def storage_download_request(receipt: StorageReceipt) -> StorageFetchRequest:
    """Fija una generación concreta; el worker verifica además el SHA de bytes."""
    if (not isinstance(receipt, StorageReceipt) or receipt.generation <= 0
            or not 0 < receipt.byte_size <= _MAX_STORAGE_BYTES
            or not isinstance(receipt.sha256, str)
            or not re.fullmatch(r'[0-9a-f]{64}', receipt.sha256)
            or not receipt.name.startswith('creative/users/')
            or receipt.mime_type not in _EXTENSIONS):
        raise ValueError('Recibo GCS no válido para descarga.')
    bucket = _bucket(receipt.bucket)
    encoded = quote(receipt.name, safe='')
    endpoint = (f'https://storage.googleapis.com/storage/v1/b/{bucket}/o/{encoded}'
                f'?alt=media&generation={receipt.generation}')
    return StorageFetchRequest(endpoint, receipt)
