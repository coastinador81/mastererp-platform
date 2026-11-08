"""Adopción canónica de un vídeo que Google escribió directamente en GCS.

Prepara y valida GCS rewrite server-side con sourceGeneration fija y destino
create-only. No hace HTTP ni interpreta timeout como éxito.
"""

from dataclasses import dataclass, replace
import re
from urllib.parse import quote
from uuid import UUID

from .creative_provider_storage_import import ImportedVideo
from .creative_storage_contracts import StorageReceipt


@dataclass(frozen=True)
class AdoptionObject:
    bucket: str
    name: str
    mime_type: str
    byte_size: int
    sha256: str


@dataclass(frozen=True)
class ProviderAdoptionDraft:
    asset_id: str
    role: str
    mime_type: str
    sha256: str
    metadata: dict
    lineage: dict
    expected: AdoptionObject


@dataclass(frozen=True)
class ProviderAdoptionRequest:
    method: str
    endpoint: str
    body: dict
    source: ImportedVideo
    draft: ProviderAdoptionDraft
    rewrite_token: str | None = None


def _uuid(value: object, label: str) -> str:
    try:
        parsed = str(UUID(value))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f'{label} no es UUID.') from None
    if parsed != value:
        raise ValueError(f'{label} no es UUID canónico.')
    return parsed


def _endpoint(source: ImportedVideo, expected: AdoptionObject,
              token: str | None = None) -> str:
    value = (f'https://storage.googleapis.com/storage/v1/b/{source.bucket}/o/'
             f'{quote(source.name, safe="")}/rewriteTo/b/{expected.bucket}/o/'
             f'{quote(expected.name, safe="")}'
             f'?sourceGeneration={source.generation}&ifGenerationMatch=0')
    return value + (f'&rewriteToken={quote(token, safe="")}' if token else '')


def provider_video_adoption_request(imported: ImportedVideo, *,
                                    owner_user_id: str, asset_id: str
                                    ) -> ProviderAdoptionRequest:
    if (not isinstance(imported, ImportedVideo) or imported.generation <= 0
            or imported.mime_type != 'video/mp4' or imported.byte_size <= 0
            or not re.fullmatch(r'[0-9a-f]{64}', imported.sha256)
            or not imported.bucket or not imported.name
            or any(item in ('', '.', '..') for item in imported.name.split('/'))):
        raise ValueError('Vídeo GCS importado no válido.')
    user_id = _uuid(owner_user_id, 'ownerUserId')
    asset_id = _uuid(asset_id, 'assetId')
    name = (f'creative/users/{user_id}/assets/{asset_id}/'
            f'{imported.sha256}.mp4')
    expected = AdoptionObject(imported.bucket, name, imported.mime_type,
                              imported.byte_size, imported.sha256)
    draft = ProviderAdoptionDraft(
        asset_id, 'generated_video', imported.mime_type, imported.sha256,
        {'kind': 'video', 'durationSeconds': imported.duration_seconds,
         'widthPixels': imported.width_pixels,
         'heightPixels': imported.height_pixels,
         'frameRate': imported.frame_rate},
        {'origin': 'google_gcs', 'sourceBucket': imported.bucket,
         'sourceName': imported.name, 'sourceGeneration': imported.generation,
         'sourceSha256': imported.sha256}, expected)
    # F9(e): objects.rewrite fija el nombre del destino en la URL (…/rewriteTo/b/<dst>/o/<name>). El
    # body es SOLO la metadata a aplicar al destino; incluir TAMBIÉN `name` en el body hace que GCS
    # devuelva 400 INVALID_ARGUMENT (observado en el re-drive de 7ee91507: RewriteObject.To
    # INVALID_ARGUMENT). Se omite `name` del body (el destino sigue fijado por _endpoint). Pendiente
    # de confirmación del campo exacto por Consultor (ficha GCS objects.rewrite).
    body = {'contentType': imported.mime_type,
            'cacheControl': 'private, no-store',
            'metadata': {'sha256': imported.sha256}}
    return ProviderAdoptionRequest(
        'POST', _endpoint(imported, expected), body, imported, draft)


def provider_video_adoption_response(request: ProviderAdoptionRequest,
                                     response: dict
                                     ) -> ProviderAdoptionRequest | StorageReceipt:
    """Valida una respuesta rewrite; si continúa, conserva el token exacto."""
    if (not isinstance(request, ProviderAdoptionRequest)
            or request.method != 'POST' or not isinstance(response, dict)):
        raise ValueError('Respuesta de adopción GCS no válida.')
    try:
        rewritten = int(response.get('totalBytesRewritten', ''))
        size = int(response.get('objectSize', ''))
    except (TypeError, ValueError):
        raise ValueError('Progreso rewrite no válido.') from None
    expected = request.draft.expected
    if size != expected.byte_size or not 0 <= rewritten <= size:
        raise ValueError('El rewrite no corresponde al vídeo importado.')
    if response.get('done') is not True:
        token = response.get('rewriteToken')
        if (not isinstance(token, str) or not 1 <= len(token) <= 2048
                or any(char.isspace() for char in token) or rewritten >= size):
            raise ValueError('Token de continuación rewrite no válido.')
        return replace(request, endpoint=_endpoint(request.source, expected, token),
                       rewrite_token=token)
    resource = response.get('resource')
    if not isinstance(resource, dict) or rewritten != size:
        raise ValueError('El rewrite completo no contiene un recurso verificable.')
    try:
        generation = int(resource.get('generation', ''))
        byte_size = int(resource.get('size', ''))
    except (TypeError, ValueError):
        raise ValueError('Recibo rewrite no válido.') from None
    metadata = resource.get('metadata')
    if (resource.get('bucket') != expected.bucket
            or resource.get('name') != expected.name
            or resource.get('contentType') != expected.mime_type
            or generation <= 0 or byte_size != expected.byte_size
            or not isinstance(metadata, dict)
            or metadata.get('sha256') != expected.sha256):
        raise ValueError('El recurso adoptado no coincide con el destino previsto.')
    return StorageReceipt(expected.bucket, expected.name, generation,
                          expected.mime_type, byte_size, expected.sha256)


def validate_provider_video_adoption_request(
        request: ProviderAdoptionRequest) -> None:
    """Reconstruye el rewrite histórico antes de que el transporte use token."""
    if not isinstance(request, ProviderAdoptionRequest):
        raise ValueError('Petición de adopción GCS no válida.')
    parts = request.draft.expected.name.split('/')
    if (len(parts) != 6 or parts[:2] != ['creative', 'users']
            or parts[3] != 'assets'):
        raise ValueError('Destino de adopción GCS no válido.')
    rebuilt = provider_video_adoption_request(
        request.source, owner_user_id=parts[2], asset_id=request.draft.asset_id)
    expected_endpoint = _endpoint(
        request.source, rebuilt.draft.expected, request.rewrite_token)
    if (request.method != rebuilt.method or request.body != rebuilt.body
            or request.source != rebuilt.source or request.draft != rebuilt.draft
            or request.endpoint != expected_endpoint):
        raise ValueError('Petición de adopción GCS alterada.')
