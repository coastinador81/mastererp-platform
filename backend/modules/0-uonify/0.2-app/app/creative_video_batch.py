"""Cierra las peticiones de cada plano antes de cotizar o pedir aprobación.

No invoca Google. La duración final requiere montaje y el subtotal Veo no
incluye almacenamiento, audio adicional, render, impuestos ni política comercial.
"""

from dataclasses import dataclass
from decimal import Decimal
from hashlib import sha256
import json

from .creative_google_capabilities import ModelId, veo_model_ids
from .creative_pricing import veo_rate_estimate
from .creative_request_fingerprint import fingerprint
from .creative_video_contracts import (VideoMedia, VideoRequest,
                                       omni_background_request, omni_request,
                                       veo_request)


_VEO_MODELS = veo_model_ids()
_OMNI = ModelId.OMNI_11


@dataclass(frozen=True)
class VideoShot:
    prompt: str
    references: tuple[VideoMedia, ...] = ()


@dataclass(frozen=True)
class VideoBatch:
    project: str
    model: str
    requested_seconds: int
    generated_seconds: int
    trim_seconds: int
    requests: tuple[VideoRequest, ...]
    request_hashes: tuple[str, ...]
    batch_sha256: str
    veo_media_subtotal_usd: Decimal | None
    approval_ready: bool = False


def prepare_video_batch(project: str, model: str, requested_seconds: int,
                        shots: tuple[VideoShot, ...], *,
                        omni_output_prefixes: tuple[str, ...] | None = None,
                        veo_output_uris: tuple[str, ...] | None = None
                        ) -> VideoBatch:
    if (not isinstance(requested_seconds, int) or isinstance(requested_seconds, bool)
            or not 3 <= requested_seconds <= 120):
        raise ValueError('Duración final solicitada no válida.')
    if (not isinstance(shots, tuple) or not 1 <= len(shots) <= 60
            or any(not isinstance(shot, VideoShot) or
                   not isinstance(shot.references, tuple) for shot in shots)):
        raise ValueError('Lista de planos no válida.')
    if model not in _VEO_MODELS | {_OMNI}:
        raise ValueError('Modelo de vídeo no auditado.')
    if omni_output_prefixes is not None and (
            model != _OMNI or not isinstance(omni_output_prefixes, tuple)
            or len(omni_output_prefixes) != len(shots)
            or len(set(omni_output_prefixes)) != len(omni_output_prefixes)):
        raise ValueError('Prefijos Omni no corresponden a los planos.')
    # §6: el lote Veo durable RECIBE el output_uri de cada intento (de la reserva); no lo
    # construye. Uno por plano, únicos, solo para modelos Veo.
    if veo_output_uris is not None and (
            model not in _VEO_MODELS or not isinstance(veo_output_uris, tuple)
            or len(veo_output_uris) != len(shots)
            or len(set(veo_output_uris)) != len(veo_output_uris)):
        raise ValueError('Los output_uri Veo no corresponden a los planos.')
    prepared = []
    for index, shot in enumerate(shots):
        if model == _OMNI:
            if omni_output_prefixes is None:
                request = omni_request(project, shot.prompt, shot.references)
            else:
                if shot.references:
                    raise ValueError(
                        'El lote Omni durable aún no admite referencias sin ownership.')
                request = omni_background_request(
                    project, shot.prompt, omni_output_prefixes[index],
                    duration_seconds=3, resolution='360p')
        elif len(shot.references) == 0:
            request = veo_request(
                project, model, shot.prompt,
                output_uri=veo_output_uris[index] if veo_output_uris else None)
        elif len(shot.references) == 1:
            request = veo_request(
                project, model, shot.prompt, shot.references[0],
                output_uri=veo_output_uris[index] if veo_output_uris else None)
        else:
            raise ValueError('Solo se auditó una imagen de sujeto por petición Veo.')
        prepared.append(request)
    requests = tuple(prepared)
    seconds = sum(
        int(item.body['response_format'][0]['duration'].removesuffix('s'))
        if model == _OMNI else int(item.body['parameters']['durationSeconds'])
        for item in requests)
    if seconds < requested_seconds:
        raise ValueError('Los planos preparados no cubren la duración solicitada.')
    hashes = tuple(fingerprint(item).sha256 for item in requests)
    canonical = json.dumps({'project': project, 'model': model,
                            'requestedSeconds': requested_seconds,
                            'requestHashes': hashes},
                           sort_keys=True, separators=(',', ':'))
    subtotal = (sum((veo_rate_estimate(item).amount_usd for item in requests),
                    Decimal('0')) if model in _VEO_MODELS else None)
    return VideoBatch(project, model, requested_seconds, seconds,
                      seconds - requested_seconds, requests, hashes,
                      sha256(canonical.encode()).hexdigest(), subtotal)
