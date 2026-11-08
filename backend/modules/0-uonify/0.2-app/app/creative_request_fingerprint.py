"""Huella de la petición multimedia exacta que deberá quedar unida a la aprobación."""

from dataclasses import dataclass
from hashlib import sha256
import json
import re

from .creative_image_contracts import ImageRequest
from .creative_cloud_tts_contracts import CloudTtsRequest
from .creative_music_contracts import MusicRequest
from .creative_video_contracts import VideoRequest
from .creative_voiceover_contracts import VoiceoverRequest


@dataclass(frozen=True)
class RequestFingerprint:
    sha256: str
    model: str
    endpoint: str
    input_hashes: tuple[str, ...]


def request_snapshot(request: ImageRequest | VideoRequest | MusicRequest |
                     VoiceoverRequest | CloudTtsRequest) -> dict:
    """Forma ejecutable canónica; contiene el body exacto, nunca bytes ocultos."""
    if not isinstance(request, (ImageRequest, VideoRequest, MusicRequest,
                                VoiceoverRequest, CloudTtsRequest)):
        raise ValueError('Petición multimedia no admitida.')
    manifest = (() if isinstance(request, (VoiceoverRequest, CloudTtsRequest))
                else request.input_manifest)
    if not isinstance(manifest, tuple) or any(
            not isinstance(item, dict) or not isinstance(item.get('sha256'), str)
            or not re.fullmatch(r'[0-9a-f]{64}', item['sha256']) for item in manifest):
        raise ValueError('Manifiesto de recursos incompleto.')
    snapshot = {'endpoint': request.endpoint, 'model': request.model,
                'body': request.body, 'inputManifest': manifest}
    if isinstance(request, CloudTtsRequest):
        snapshot['quotaProject'] = request.quota_project
    return snapshot


def request_snapshot_json(request: ImageRequest | VideoRequest | MusicRequest |
                          VoiceoverRequest | CloudTtsRequest) -> str:
    return json.dumps(request_snapshot(request), ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False)


def fingerprint(request: ImageRequest | VideoRequest | MusicRequest |
                VoiceoverRequest | CloudTtsRequest) -> RequestFingerprint:
    snapshot = request_snapshot(request)
    canonical = json.dumps(snapshot, ensure_ascii=False, sort_keys=True,
                           separators=(',', ':'), allow_nan=False)
    return RequestFingerprint(sha256(canonical.encode('utf-8')).hexdigest(),
                              request.model, request.endpoint,
                              tuple(item['sha256'] for item in snapshot['inputManifest']))
