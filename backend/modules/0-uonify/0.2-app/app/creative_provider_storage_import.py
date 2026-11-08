"""Inspección read-only de un vídeo que Google escribió directamente en GCS.

No crea assets ni cambia ownership. Fija la generación observada, descarga esa
generación una sola vez y valida bytes antes de entregar un recibo al futuro
servicio de assets.
"""

from base64 import b64decode
from binascii import Error as Base64Error
from dataclasses import dataclass
from hashlib import md5, sha256
from urllib.parse import quote, urlsplit

import requests

from .creative_storage_transport import require_private_bucket
from .creative_video_contracts import (VideoUriOutput, mp4_duration_seconds,
                                       mp4_video_geometry)


_MAX_PROVIDER_VIDEO_BYTES = 250_000_000


class ProviderStorageImportError(Exception):
    """El objeto no puede adoptarse como medio verificado."""


class ProviderStorageImportUnknown(ProviderStorageImportError):
    """La lectura falló; nunca implica repetir la generación."""


@dataclass(frozen=True)
class ImportedVideo:
    bucket: str
    name: str
    generation: int
    mime_type: str
    byte_size: int
    sha256: str
    duration_seconds: float
    width_pixels: int
    height_pixels: int
    frame_rate: float


def _location(output: VideoUriOutput) -> tuple[str, str]:
    if not isinstance(output, VideoUriOutput):
        raise ValueError('Salida GCS de proveedor no válida.')
    parsed = urlsplit(output.uri)
    name = parsed.path.removeprefix('/')
    if (parsed.scheme != 'gs' or not parsed.netloc or not name
            or parsed.query or parsed.fragment or '%' in name
            or any(value in ('', '.', '..') for value in name.split('/'))):
        raise ValueError('URI GCS de proveedor no válida.')
    return parsed.netloc, name


def import_generated_video_once(output: VideoUriOutput, token: str,
                                session: requests.Session, *,
                                expected_location: str) -> ImportedVideo:
    """Lee metadata y una generación fija; no hace POST, copy ni retry."""
    bucket, name = _location(output)
    if not isinstance(token, str) or not token:
        raise ValueError('Autorización Cloud Storage ausente.')
    require_private_bucket(bucket, expected_location, token, session)
    headers = {'Authorization': 'Bearer ' + token}
    metadata_url = (f'https://storage.googleapis.com/storage/v1/b/{bucket}/o/'
                    f'{quote(name, safe="")}')
    try:
        metadata_response = session.request('GET', metadata_url, headers=headers,
                                            timeout=(10, 20))
    except requests.RequestException as error:
        raise ProviderStorageImportUnknown(
            'No se pudo fijar la generación GCS; no repetir generación.') from error
    try:
        if metadata_response.status_code != 200:
            raise ProviderStorageImportUnknown(
                'El objeto GCS generado todavía no es verificable.')
        try:
            metadata = metadata_response.json()
            generation = int(metadata.get('generation', ''))
            byte_size = int(metadata.get('size', ''))
        except (AttributeError, TypeError, ValueError,
                requests.RequestException) as error:
            raise ProviderStorageImportUnknown(
                'Los metadatos GCS generados son ilegibles.') from error
        if (metadata.get('bucket') != bucket or metadata.get('name') != name
                or metadata.get('contentType') != 'video/mp4'
                or generation <= 0
                or not 0 < byte_size <= _MAX_PROVIDER_VIDEO_BYTES):
            raise ProviderStorageImportError(
                'Los metadatos GCS no describen el vídeo esperado.')
        expected_md5 = metadata.get('md5Hash')
        if expected_md5 is not None:
            try:
                if len(b64decode(expected_md5, validate=True)) != 16:
                    raise ValueError
            except (Base64Error, ValueError, TypeError) as error:
                raise ProviderStorageImportError('Checksum GCS no válido.') from error
    finally:
        metadata_response.close()

    media_url = metadata_url + f'?alt=media&generation={generation}'
    try:
        media_response = session.request('GET', media_url, headers=headers,
                                         timeout=(10, 180), stream=True)
    except requests.RequestException as error:
        raise ProviderStorageImportUnknown(
            'Descarga GCS interrumpida; no repetir generación.') from error
    try:
        if media_response.status_code != 200:
            raise ProviderStorageImportUnknown(
                'No se pudo leer la generación GCS fijada.')
        chunks, count = [], 0
        sha_digest, md5_digest = sha256(), md5()
        for chunk in media_response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            count += len(chunk)
            if count > byte_size:
                raise ProviderStorageImportError(
                    'El vídeo GCS excede el tamaño declarado.')
            chunks.append(chunk)
            sha_digest.update(chunk)
            md5_digest.update(chunk)
        if count != byte_size:
            raise ProviderStorageImportError(
                'El vídeo GCS no coincide con el tamaño declarado.')
        if expected_md5 is not None and b64decode(expected_md5) != md5_digest.digest():
            raise ProviderStorageImportError(
                'El vídeo GCS no coincide con su checksum.')
        data = b''.join(chunks)
        duration = mp4_duration_seconds(data)
        width, height, frame_rate = mp4_video_geometry(data)
        return ImportedVideo(bucket, name, generation, 'video/mp4', count,
                             sha_digest.hexdigest(), duration, width, height,
                             frame_rate)
    except ValueError as error:
        raise ProviderStorageImportError(
            'El objeto GCS no contiene un MP4 verificable.') from error
    except requests.RequestException as error:
        raise ProviderStorageImportUnknown(
            'Descarga GCS interrumpida; no repetir generación.') from error
    finally:
        media_response.close()
