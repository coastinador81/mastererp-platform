"""Prepara assets GCS desde un resultado Google verificado, sin hacer HTTP.

El servicio de assets futuro asigna los UUID y persiste ownership, recibos y
linaje. Este módulo solo une intento/huella/bytes con cargas create-only.
"""

from dataclasses import dataclass
from uuid import UUID

from .creative_audio_prepare import voiceover_wav
from .creative_cloud_tts_contracts import CloudTtsOutput
from .creative_google_capabilities import ModelId
from .creative_google_transport import GoogleDispatchResult
from .creative_image_contracts import ImageOutput
from .creative_music_contracts import MusicOutput
from .creative_storage_contracts import (ResumableStorageRequest, StorageRequest,
                                         StreamingStorageRequest, storage_upload)
from .creative_video_contracts import VideoOutput
from .creative_voiceover_contracts import VoiceoverOutput


@dataclass(frozen=True)
class GeneratedStorageDraft:
    asset_id: str
    role: str
    mime_type: str
    sha256: str
    metadata: dict
    lineage: dict
    upload: StorageRequest | ResumableStorageRequest | StreamingStorageRequest


def _id(value: str, label: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError) as error:
        raise ValueError(f'{label} debe ser UUID.') from error


def _draft(bucket, user_id, asset_id, attempt_id, request_hash, role,
           mime_type, data, digest, metadata, lineage=None):
    upload = storage_upload(bucket, user_id, asset_id, mime_type, data)
    if upload.expected.sha256 != digest:
        raise ValueError('Los bytes generados no coinciden con su huella.')
    origin = lineage or {'origin': 'google', 'attemptId': attempt_id,
                         'requestSha256': request_hash,
                         'outputSha256': digest}
    return GeneratedStorageDraft(asset_id, role, mime_type, digest,
                                 metadata, origin, upload)


def generated_storage_plan(result: GoogleDispatchResult, bucket: str,
                           user_id: str,
                           asset_ids: tuple[str, ...]) -> tuple[GeneratedStorageDraft, ...]:
    """Cada output usa un UUID; Voiceover usa dos: PCM fuente y WAV derivado."""
    if (not isinstance(result, GoogleDispatchResult) or result.state != 'completed'
            or not result.outputs):
        raise ValueError('Google aún no entregó resultados almacenables.')
    user_id = _id(user_id, 'Usuario')
    if not isinstance(asset_ids, tuple):
        raise ValueError('Los IDs de assets deben estar cerrados.')
    needed = sum(2 if isinstance(item, VoiceoverOutput) else 1
                 for item in result.outputs)
    if len(asset_ids) != needed:
        raise ValueError('Cantidad de IDs de assets distinta de los resultados.')
    normalized_ids = tuple(_id(value, 'Asset') for value in asset_ids)
    if len(set(normalized_ids)) != len(normalized_ids):
        raise ValueError('Los IDs de assets no pueden repetirse.')
    drafts, cursor = [], 0
    for item in result.outputs:
        if isinstance(item, ImageOutput):
            drafts.append(_draft(bucket, user_id, normalized_ids[cursor],
                result.attempt_id, result.request_sha256, 'generated_image',
                item.mime_type, item.data, item.sha256,
                {'kind': 'image', 'widthPixels': item.width_pixels,
                 'heightPixels': item.height_pixels}))
            cursor += 1
        elif isinstance(item, VideoOutput):
            drafts.append(_draft(bucket, user_id, normalized_ids[cursor],
                result.attempt_id, result.request_sha256, 'generated_video',
                item.mime_type, item.data, item.sha256,
                {'kind': 'video', 'durationSeconds': item.duration_seconds,
                 'widthPixels': item.width_pixels, 'heightPixels': item.height_pixels,
                 'frameRate': item.frame_rate}))
            cursor += 1
        elif isinstance(item, MusicOutput):
            drafts.append(_draft(bucket, user_id, normalized_ids[cursor],
                result.attempt_id, result.request_sha256, 'generated_music',
                item.mime_type, item.data, item.sha256,
                {'kind': 'audio', 'encoding': 'mp3',
                 'sourceModel': ModelId.LYRIA_3.value,
                 'sampleRateHz': item.sample_rate_hz,
                 'channels': item.channels,
                 'bitrateKbps': item.bitrate_kbps,
                 'durationSeconds': item.duration_seconds}))
            cursor += 1
        elif isinstance(item, CloudTtsOutput):
            drafts.append(_draft(bucket, user_id, normalized_ids[cursor],
                result.attempt_id, result.request_sha256, 'generated_voice_mp3',
                item.mime_type, item.data, item.sha256,
                {'kind': 'audio', 'encoding': 'mp3',
                 'sourceModel': ModelId.CHIRP_3_HD.value,
                 'sampleRateHz': item.sample_rate_hz,
                 'channels': item.channels,
                 'durationSeconds': item.duration_seconds}))
            cursor += 1
        elif isinstance(item, VoiceoverOutput):
            source_id, derived_id = normalized_ids[cursor:cursor + 2]
            source = _draft(bucket, user_id, source_id, result.attempt_id,
                result.request_sha256, 'generated_voice_pcm', item.mime_type,
                item.data, item.sha256,
                {'kind': 'audio', 'encoding': 'pcm_l16',
                 'sampleRateHz': item.sample_rate_hz, 'channels': item.channels,
                 'sampleWidthBytes': item.sample_width_bytes,
                 'samplesPerChannel': len(item.data) // item.sample_width_bytes,
                 'durationSeconds': item.duration_seconds})
            prepared = voiceover_wav(item)
            lineage = {'origin': 'derived', 'sourceAssetId': source_id,
                       'sourceSha256': item.sha256,
                       'transformId': 'pcm_l16_to_wav', 'transformVersion': 1,
                       'resultSha256': prepared.sha256}
            derived = _draft(bucket, user_id, derived_id, result.attempt_id,
                result.request_sha256, 'derived_voice_wav', prepared.mime_type,
                prepared.data, prepared.sha256,
                {'kind': 'audio', 'encoding': 'pcm_wav',
                 'sampleRateHz': prepared.sample_rate_hz,
                 'channels': prepared.channels,
                 'sampleWidthBytes': prepared.sample_width_bytes,
                 'samplesPerChannel': prepared.samples_per_channel,
                 'durationSeconds': prepared.duration_seconds}, lineage)
            drafts.extend((source, derived))
            cursor += 2
        else:
            raise ValueError('Tipo de resultado Google no admitido para almacenamiento.')
    return tuple(drafts)
