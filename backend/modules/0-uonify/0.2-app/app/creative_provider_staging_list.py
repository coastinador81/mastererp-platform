"""Listado READ-ONLY de staging GCS para la recuperación por adopción (clips-only). STAGED + INERTE.

objects.list de EXACTAMENTE el prefijo op-scoped PERSISTIDO del intento (`ctx.expected_output_prefix`),
NUNCA reconstruido ni por glob: selecciona el ÚNICO `sample_0.mp4` del render Veo bajo ese prefijo y lo
devuelve como `VideoUriOutput` para el MISMO camino de import/adopción endurecido que la adopción normal.
Sirve a la RECUPERACIÓN cuando el LRO caducó (el objeto persiste en GCS aunque fetchPredictOperation ya no
responda `done`): aquí NO se consulta el LRO, NO se escribe y NO se re-POSTea — solo se LISTA.

Reglas de pertenencia (= las de `veo_completed_uris` + el discriminador de nombre que esa ruta no necesita
porque Veo le NOMBRA el objeto en la respuesta; aquí hay que distinguir el clip de sus auxiliares):
  * bajo el prefijo (scheme gs, bucket == netloc del prefijo, name empieza por el path del prefijo),
  * ruta relativa 1..16 segmentos, sin '', '.' ni '..' ni '%',
  * patrón de nombre: `sample_0.mp4` directo o bajo subcarpeta(s) NUMÉRICA(S) (forma del clip ENTREGADO
    #5, la que acepta `veo_completed_uris`). La integridad REAL (bytes/sha/md5/MP4/tamaño) la verifica
    `import_generated_video_once`; aquí solo el patrón de nombre bajo el prefijo autorizado.

0 objetos → None (el llamador desambigua por ventana de render; nunca un bucle aquí). >1 →
`StagingListAmbiguous` (nunca adoptar un clip al azar). Incierto (red/5xx/permiso/404 tras bucket privado
verificado) → `StagingListUnknown` (re-conducible, jamás re-POST). Determinista (prefijo/listado malformado)
→ `StagingListInvalid`. D-PROTECCIÓN: no registra gs://, ids, tokens ni hashes. VUELVE a Consultor + REA.
"""
from __future__ import annotations

import re
from urllib.parse import quote, urlsplit

import requests

from .creative_storage_transport import StorageTransportError, require_private_bucket
from .creative_video_contracts import VideoUriOutput

_STAGING_VIDEO_BASENAME = 'sample_0.mp4'
_PAGE_CAP = 16        # tope defensivo de páginas (clips-only: 1 vídeo + auxiliares)
_ITEM_CAP = 4096      # tope defensivo de objetos a inspeccionar
_BUCKET = re.compile(r'[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]')


class StagingListError(Exception):
    """El listado de staging no es adoptable."""


class StagingListUnknown(StagingListError):
    """El listado falló de forma incierta (red/5xx/permiso); nunca implica re-POST."""


class StagingListInvalid(StagingListError):
    """El listado o el prefijo no son verificables (determinista)."""


class StagingListAmbiguous(StagingListError):
    """Más de un sample_0.mp4 bajo el prefijo: no adoptar un clip al azar."""


def _parse_prefix(prefix_uri: object) -> tuple[str, str]:
    """Descompone el prefijo gs://bucket/path/ (el PERSISTIDO en el intento) en (bucket, path) con las
    MISMAS reglas que `_prefix` de veo_completed_uris. `path` termina en '/'. Fail-closed → Invalid."""
    parsed = urlsplit(prefix_uri) if isinstance(prefix_uri, str) else None
    if (not parsed or not 1 <= len(prefix_uri) <= 2048 or parsed.scheme != 'gs'
            or not parsed.netloc or not _BUCKET.fullmatch(parsed.netloc)
            or parsed.query or parsed.fragment or '%' in parsed.path
            or not parsed.path.endswith('/')):
        raise StagingListInvalid('Prefijo de staging GCS no válido.')
    path = parsed.path.lstrip('/')
    segments = path.strip('/').split('/')
    if not path or any(seg in ('', '.', '..') for seg in segments):
        raise StagingListInvalid('Prefijo de staging GCS no válido.')
    return parsed.netloc, path


def _is_staged_clip(name: object, prefix_path: str) -> bool:
    """El objeto está bajo el prefijo y su ruta relativa es `sample_0.mp4` o `<digits>/…/sample_0.mp4`
    (subcarpeta(s) numérica(s)), 1..16 segmentos, sin '', '.', '..', '%'. Mismo subconjunto que acepta
    `veo_completed_uris`, con el discriminador de nombre que esa ruta no necesita."""
    if not isinstance(name, str) or '%' in name or not name.startswith(prefix_path):
        return False
    relative = name[len(prefix_path):]
    parts = relative.split('/')
    return bool(
        relative and 1 <= len(parts) <= 16
        and all(seg not in ('', '.', '..') for seg in parts)
        and parts[-1] == _STAGING_VIDEO_BASENAME
        and all(seg.isdigit() for seg in parts[:-1]))


def select_staged_video_output(prefix_uri: str, token: str,
                               session: requests.Session, *,
                               expected_location: str) -> VideoUriOutput | None:
    """Devuelve el ÚNICO `VideoUriOutput` sample_0.mp4 bajo el prefijo, `None` si no hay ninguno, o lanza
    si hay más de uno / el listado es incierto. READ-ONLY: `require_private_bucket` (location + privado) +
    objects.list paginado con topes defensivos. No escribe ni consulta el LRO."""
    bucket, prefix_path = _parse_prefix(prefix_uri)
    if not isinstance(token, str) or not token:
        raise StagingListInvalid('Autorización Cloud Storage ausente.')
    try:
        require_private_bucket(bucket, expected_location, token, session)
    except StorageTransportError as error:
        raise StagingListUnknown(
            'No se pudo verificar el bucket de staging; no re-POSTear.') from error
    except ValueError as error:
        raise StagingListInvalid('Bucket de staging no verificable.') from error
    base = (f'https://storage.googleapis.com/storage/v1/b/{bucket}/o'
            f'?prefix={quote(prefix_path, safe="")}&maxResults=1000'
            f'&fields=items(name,bucket),nextPageToken')
    headers = {'Authorization': 'Bearer ' + token}
    match: str | None = None
    page_token: str | None = None
    inspected = 0
    for _ in range(_PAGE_CAP):
        url = base + (f'&pageToken={quote(page_token, safe="")}' if page_token else '')
        try:
            response = session.request('GET', url, headers=headers,
                                       timeout=(10, 30), allow_redirects=False)
        except requests.RequestException:
            raise StagingListUnknown('Listado de staging GCS interrumpido.') from None
        try:
            code = response.status_code
            if code == 404 or code in (401, 403, 408, 429) or code >= 500:
                raise StagingListUnknown('El listado de staging GCS no es verificable.')
            if code != 200:
                raise StagingListInvalid('El listado de staging GCS fue rechazado.')
            try:
                payload = response.json()
            except (ValueError, requests.RequestException):
                raise StagingListUnknown('El listado de staging GCS no es legible.') from None
        finally:
            response.close()
        if not isinstance(payload, dict):
            raise StagingListInvalid('El listado de staging GCS no es un objeto.')
        items = payload.get('items') or []
        if not isinstance(items, list):
            raise StagingListInvalid('El listado de staging GCS no es verificable.')
        for item in items:
            inspected += 1
            if inspected > _ITEM_CAP:
                raise StagingListUnknown('El listado de staging GCS excede el tope.')
            if not isinstance(item, dict):
                continue
            if (item.get('bucket') not in (None, bucket)
                    or not _is_staged_clip(item.get('name'), prefix_path)):
                continue
            candidate = f'gs://{bucket}/{item["name"]}'
            if candidate == match:
                continue
            if match is not None:
                raise StagingListAmbiguous(
                    'Más de un clip en staging bajo el prefijo.')
            match = candidate
        page_token = payload.get('nextPageToken')
        if not page_token or not isinstance(page_token, str):
            break
    if match is None:
        return None
    return VideoUriOutput('video/mp4', match, None)
