"""Referencia visual GCS para Lyria 3 Clip, sin hacer HTTP."""

from dataclasses import dataclass
import re
from urllib.parse import urlsplit

from .creative_music_contracts import MODEL, MusicRequest


_PROJECT = re.compile(r'[a-z][a-z0-9-]{4,61}[a-z0-9]\Z')
_HASH = re.compile(r'[0-9a-f]{64}\Z')
_BUCKET = re.compile(r'[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]\Z')
_MIMES = frozenset({'image/jpeg', 'image/png'})


@dataclass(frozen=True)
class MusicGcsImageReference:
    uri: str
    mime_type: str
    byte_size: int
    sha256: str
    generation: int


def _snapshot(reference: MusicGcsImageReference) -> dict:
    if (not isinstance(reference, MusicGcsImageReference)
            or reference.mime_type not in _MIMES
            or not isinstance(reference.byte_size, int)
            or isinstance(reference.byte_size, bool)
            or not 1 <= reference.byte_size <= 30_000_000
            or not isinstance(reference.sha256, str)
            or not _HASH.fullmatch(reference.sha256)
            or not isinstance(reference.generation, int)
            or isinstance(reference.generation, bool)
            or reference.generation <= 0
            or not isinstance(reference.uri, str)
            or len(reference.uri) > 2048 or '%' in reference.uri):
        raise ValueError('Referencia visual Lyria no válida.')
    parsed = urlsplit(reference.uri)
    segments = parsed.path.strip('/').split('/')
    if (parsed.scheme != 'gs' or not _BUCKET.fullmatch(parsed.netloc or '')
            or parsed.query or parsed.fragment or parsed.path.endswith('/')
            or not segments or any(not item or item in ('.', '..')
                                   for item in segments)):
        raise ValueError('Referencia visual Lyria no válida.')
    return {
        'kind': 'image', 'role': 'music_image_reference', 'ordinal': 1,
        'uri': reference.uri, 'mimeType': reference.mime_type,
        'bytes': reference.byte_size, 'sha256': reference.sha256,
        'generation': reference.generation,
    }


def music_image_request(
        project: str, prompt: str,
        reference: MusicGcsImageReference) -> MusicRequest:
    """Construye texto+una imagen GCS para un único clip de 30 segundos."""
    if not isinstance(project, str) or not _PROJECT.fullmatch(project):
        raise ValueError('Proyecto Google no válido.')
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 4000:
        raise ValueError('Instrucción musical no válida.')
    source = _snapshot(reference)
    endpoint = (f'https://aiplatform.googleapis.com/v1beta1/projects/{project}'
                '/locations/global/interactions')
    body = {
        'model': MODEL, 'store': False,
        'input': [
            {'type': 'text', 'text': prompt.strip()},
            {'type': 'image', 'mime_type': reference.mime_type,
             'uri': reference.uri},
        ],
    }
    return MusicRequest(endpoint, MODEL, body, (source,))
