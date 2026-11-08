"""Techos de generación Google para peticiones creativas exactas.

El módulo no consulta Google, no persiste aprobaciones y no abre ejecución. Un
servicio interno debe aportar una instantánea vigente de tarifas oficiales. La
salida se liga al ``ExecutionBinding`` y puede combinarse con los costes de
Storage/Transcoder mediante ``composite_quote_readiness``.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_CEILING
import re
from uuid import NAMESPACE_URL, UUID, uuid5

from .creative_cloud_tts_contracts import CloudTtsRequest
from .creative_google_capabilities import ModelId, image_model_ids, veo_model_ids
from .creative_composite_quote import (
    CostCeiling, ExecutionBinding, canonical_sha256,
    execution_binding_sha256)
from .creative_image_contracts import ImageRequest
from .creative_music_contracts import MusicRequest
from .creative_request_fingerprint import fingerprint
from .creative_video_contracts import VideoRequest
from .creative_voiceover_contracts import VoiceoverRequest


PRICING_URL = (
    "https://cloud.google.com/gemini-enterprise-agent-platform/"
    "generative-ai/pricing")
TTS_PRICING_URL = "https://cloud.google.com/text-to-speech/pricing"
CENT = Decimal("0.01")
MILLION = Decimal(1_000_000)
HASH = re.compile(r"[0-9a-f]{64}\Z")


class GoogleMaximumUnavailable(ValueError):
    """La tarifa conocida no basta para autorizar un máximo."""


@dataclass(frozen=True)
class GoogleGenerationRateSnapshot:
    """Tarifas server-owned observadas en la documentación oficial."""

    image_input_per_million_usd: dict[str, Decimal]
    image_text_output_per_million_usd: dict[str, Decimal]
    image_1k_output_usd: dict[str, Decimal]
    image_input_tokens: dict[str, int]
    veo_audio_720p_per_second_usd: dict[str, Decimal]
    omni_input_per_million_usd: Decimal
    omni_text_output_per_million_usd: Decimal
    omni_video_output_per_million_usd: Decimal
    omni_image_input_tokens: int
    omni_video_input_tokens_per_second: int
    omni_video_output_tokens_per_second: dict[str, int]
    lyria_30s_clip_usd: Decimal
    tts_input_per_million_usd: Decimal
    tts_output_per_million_usd: Decimal
    chirp_per_million_characters_usd: Decimal
    pricing_evidence_sha256: str
    tts_evidence_sha256: str
    checked_at: datetime
    expires_at: datetime


# H8: derivados de la FUENTE ÚNICA (creative_google_capabilities), no re-listados aquí.
_IMAGE_MODELS = image_model_ids()
_VEO_MODELS = veo_model_ids()
_RATE_KEYS = {
    "image_input_per_million_usd": _IMAGE_MODELS,
    "image_text_output_per_million_usd": _IMAGE_MODELS,
    "image_1k_output_usd": _IMAGE_MODELS,
    "image_input_tokens": _IMAGE_MODELS,
    "veo_audio_720p_per_second_usd": _VEO_MODELS,
}
_TTS_MAX_INPUT_TOKENS = 8192
_TTS_MAX_OUTPUT_TOKENS = 16384
_OMNI = ModelId.OMNI_11
_OMNI_RESOLUTIONS = frozenset({"360p", "720p", "1080p", "4k"})
_OMNI_MAX_OUTPUT_TOKENS = 57_920


def _decimal(value: object, label: str) -> Decimal:
    if (not isinstance(value, Decimal) or not value.is_finite() or value < 0
            or value.as_tuple().exponent < -9):
        raise ValueError(f"{label} no es una tarifa verificable.")
    return value


def _cent(value: Decimal) -> Decimal:
    if value == 0:
        return Decimal("0.00")
    return value.quantize(CENT, rounding=ROUND_CEILING)


def _validate_rates(rates: GoogleGenerationRateSnapshot,
                    now: datetime) -> None:
    if (not isinstance(rates, GoogleGenerationRateSnapshot)
            or not isinstance(now, datetime) or not now.tzinfo
            or not rates.checked_at.tzinfo or not rates.expires_at.tzinfo
            or rates.checked_at > now
            or now - rates.checked_at > timedelta(days=1)
            or rates.expires_at <= now
            or rates.expires_at > now + timedelta(days=1)
            or not HASH.fullmatch(rates.pricing_evidence_sha256)
            or not HASH.fullmatch(rates.tts_evidence_sha256)):
        raise ValueError("La evidencia de tarifas Google no está vigente.")
    for field, keys in _RATE_KEYS.items():
        values = getattr(rates, field)
        if not isinstance(values, dict) or set(values) != keys:
            raise ValueError("La instantánea de tarifas Google está incompleta.")
        for value in values.values():
            if field == "image_input_tokens":
                if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                    raise ValueError("La instantánea de tarifas Google está incompleta.")
            else:
                _decimal(value, "La tarifa Google")
                if value <= 0:
                    raise ValueError("La instantánea de tarifas Google está incompleta.")
    if (not isinstance(rates.omni_image_input_tokens, int)
            or isinstance(rates.omni_image_input_tokens, bool)
            or rates.omni_image_input_tokens <= 0
            or not isinstance(rates.omni_video_input_tokens_per_second, int)
            or isinstance(rates.omni_video_input_tokens_per_second, bool)
            or rates.omni_video_input_tokens_per_second <= 0
            or not isinstance(rates.omni_video_output_tokens_per_second, dict)
            or set(rates.omni_video_output_tokens_per_second) != _OMNI_RESOLUTIONS
            or any(not isinstance(value, int) or isinstance(value, bool) or value <= 0
                   for value in rates.omni_video_output_tokens_per_second.values())):
        raise ValueError("La instantánea de tarifas Google está incompleta.")
    for value in (rates.omni_input_per_million_usd,
                  rates.omni_text_output_per_million_usd,
                  rates.omni_video_output_per_million_usd,
                  rates.lyria_30s_clip_usd,
                  rates.tts_input_per_million_usd,
                  rates.tts_output_per_million_usd,
                  rates.chirp_per_million_characters_usd):
        _decimal(value, "La tarifa Google")
        if value <= 0:
            raise ValueError("La instantánea de tarifas Google está incompleta.")


def _operation(binding: ExecutionBinding, operation_id: str, request):
    binding_sha = execution_binding_sha256(binding)
    try:
        normalized = str(UUID(operation_id))
    except (ValueError, TypeError, AttributeError):
        raise ValueError("La operación Google no es válida.") from None
    matches = tuple(item for item in binding.request_operations
                    if item.operation_id == normalized)
    if len(matches) != 1:
        raise ValueError("La operación Google no pertenece al binding.")
    item = matches[0]
    exact = fingerprint(request)
    if (item.request_sha256 != exact.sha256 or item.model != exact.model
            or item.endpoint != exact.endpoint):
        raise ValueError("La petición Google cambió después del presupuesto.")
    return binding_sha, item, exact


def _text_bytes(parts: object) -> int:
    if not isinstance(parts, list):
        return 0
    return sum(len(part.get("text", "").encode("utf-8"))
               for part in parts if isinstance(part, dict)
               and isinstance(part.get("text"), str))


def _image_maximum(request: ImageRequest,
                   rates: GoogleGenerationRateSnapshot) -> tuple[Decimal, dict]:
    if request.model not in _IMAGE_MODELS:
        raise ValueError("Modelo de imagen sin tarifa cerrada.")
    contents = request.body.get("contents")
    if not isinstance(contents, list) or len(contents) != 1:
        raise ValueError("Petición de imagen sin contenido cerrado.")
    parts = contents[0].get("parts") if isinstance(contents[0], dict) else None
    input_text_tokens = _text_bytes(parts)
    config = request.body.get("generationConfig")
    output_text_tokens = (config.get("maxOutputTokens")
                          if isinstance(config, dict) else None)
    if (not isinstance(output_text_tokens, int)
            or isinstance(output_text_tokens, bool)
            or not 1 <= output_text_tokens <= 8192):
        raise GoogleMaximumUnavailable(
            "La imagen no fija un máximo de texto y razonamiento.")
    # H3: la tarifa cerrada es 1 imagen a 1K. Si el cuerpo pide otra resolución
    # (2K/4K cuesta más) o varias candidatas, no se cotiza por debajo: se rechaza.
    image_config = config.get("imageConfig") if isinstance(config, dict) else None
    image_size = (image_config.get("imageSize")
                  if isinstance(image_config, dict) else None)
    candidate_count = config.get("candidateCount") if isinstance(config, dict) else None
    if (image_size != "1K"
            or (candidate_count is not None
                and (not isinstance(candidate_count, int)
                     or isinstance(candidate_count, bool)
                     or candidate_count != 1))):
        raise GoogleMaximumUnavailable(
            "La imagen solo tiene tarifa cerrada a 1K y una sola salida.")
    image_count = sum(item.get("kind") == "image"
                      for item in request.input_manifest
                      if isinstance(item, dict))
    media_parts = [item for item in parts if isinstance(item, dict)
                   and ("inlineData" in item or "fileData" in item)]
    if (image_count != len(request.input_manifest) or image_count > 14
            or len(media_parts) != image_count):
        raise ValueError("El manifiesto de imagen no coincide con la petición.")
    input_tokens = (input_text_tokens
                    + image_count * rates.image_input_tokens[request.model])
    maximum = (
        Decimal(input_tokens)
        * rates.image_input_per_million_usd[request.model] / MILLION
        + Decimal(output_text_tokens)
        * rates.image_text_output_per_million_usd[request.model] / MILLION
        + rates.image_1k_output_usd[request.model])
    return maximum, {
        "inputTokenCeiling": input_tokens,
        "textOutputTokenCeiling": output_text_tokens,
        "imageOutputCount": 1,
        "imageSize": "1K",
    }


def _veo_maximum(request: VideoRequest,
                 rates: GoogleGenerationRateSnapshot) -> tuple[Decimal, dict]:
    parameters = request.body.get("parameters")
    if (request.model not in _VEO_MODELS or not isinstance(parameters, dict)
            or parameters.get("sampleCount") != 1
            or parameters.get("generateAudio") is not True
            or parameters.get("resolution") != "720p"):
        raise GoogleMaximumUnavailable("La variante Veo no tiene un máximo cerrado.")
    seconds = parameters.get("durationSeconds")
    if not isinstance(seconds, int) or isinstance(seconds, bool) or seconds not in (4, 8):
        raise GoogleMaximumUnavailable("La duración Veo no tiene tarifa cerrada.")
    rate = rates.veo_audio_720p_per_second_usd[request.model]
    return Decimal(seconds) * rate, {
        "durationSeconds": seconds,
        "sampleCount": 1,
        "resolution": "720p",
        "audio": True,
    }


def _omni_maximum(request: VideoRequest,
                  rates: GoogleGenerationRateSnapshot) -> tuple[Decimal, dict]:
    if request.model != _OMNI:
        raise ValueError("Modelo Omni sin tarifa cerrada.")
    config = request.body.get("generation_config")
    response = request.body.get("response_format")
    inputs = request.body.get("input")
    if (not isinstance(config, dict) or not isinstance(response, list)
            or len(response) != 1 or not isinstance(response[0], dict)
            or not isinstance(inputs, list)):
        raise ValueError("Petición Omni sin contenido cerrado.")
    maximum_tokens = config.get("max_output_tokens")
    if (config.get("thinking_level") != "minimal"
            or config.get("thinking_summaries") != "none"
            or maximum_tokens != _OMNI_MAX_OUTPUT_TOKENS):
        raise GoogleMaximumUnavailable(
            "Omni no fija el techo canónico de texto y razonamiento.")
    output = response[0]
    resolution = output.get("resolution")
    if resolution not in _OMNI_RESOLUTIONS or output.get("type") != "video":
        raise GoogleMaximumUnavailable("La salida Omni no tiene tarifa cerrada.")
    duration = output.get("duration")
    if isinstance(duration, str) and re.fullmatch(r"[3-9]s|10s", duration):
        seconds = int(duration[:-1])
    elif request.mode in ("edit", "edit_background"):
        videos = [item for item in request.input_manifest
                  if isinstance(item, dict) and item.get("kind") == "video"]
        if len(videos) != 1 or not isinstance(videos[0].get("durationSeconds"),
                                                (int, float)):
            raise GoogleMaximumUnavailable(
                "La edición Omni no tiene duración cerrada.")
        seconds = int(videos[0]["durationSeconds"])
        if seconds != videos[0]["durationSeconds"] or seconds not in range(1, 11):
            raise GoogleMaximumUnavailable(
                "La edición Omni no tiene duración cerrada.")
    else:
        raise GoogleMaximumUnavailable("La duración Omni no tiene tarifa cerrada.")
    text_inputs = [item for item in inputs if isinstance(item, dict)
                   and item.get("type") == "text"
                   and isinstance(item.get("text"), str)]
    media_inputs = tuple(item.get("type") for item in inputs
                         if isinstance(item, dict)
                         and item.get("type") in ("image", "video"))
    manifest_kinds = tuple(item.get("kind") for item in request.input_manifest
                           if isinstance(item, dict))
    durations = [item.get("durationSeconds")
                 for item in request.input_manifest
                 if isinstance(item, dict) and item.get("kind") == "video"]
    if (len(text_inputs) != 1 or len(inputs) != 1 + len(media_inputs)
            or media_inputs != manifest_kinds
            or any(not isinstance(value, (int, float))
                   or isinstance(value, bool) or not 0 < value <= 10
                   for value in durations)):
        raise ValueError("El manifiesto Omni no coincide con la petición.")
    text_bytes = len(text_inputs[0]["text"].encode("utf-8"))
    image_count = manifest_kinds.count("image")
    video_seconds = sum(Decimal(str(value)) for value in durations)
    input_tokens = (text_bytes
                    + image_count * rates.omni_image_input_tokens
                    + video_seconds * rates.omni_video_input_tokens_per_second)
    video_output_tokens = (
        seconds * rates.omni_video_output_tokens_per_second[resolution])
    maximum = (
        Decimal(input_tokens) * rates.omni_input_per_million_usd / MILLION
        + Decimal(maximum_tokens)
        * rates.omni_text_output_per_million_usd / MILLION
        + Decimal(video_output_tokens)
        * rates.omni_video_output_per_million_usd / MILLION)
    return maximum, {
        "inputTokenCeiling": str(input_tokens),
        "textAndReasoningTokenCeiling": maximum_tokens,
        "videoOutputTokenCeiling": video_output_tokens,
        "durationSeconds": seconds,
        "resolution": resolution,
        "thinkingLevel": "minimal",
    }


def _voice_maximum(request: VoiceoverRequest,
                   rates: GoogleGenerationRateSnapshot) -> tuple[Decimal, dict]:
    maximum = (
        Decimal(_TTS_MAX_INPUT_TOKENS) * rates.tts_input_per_million_usd
        + Decimal(_TTS_MAX_OUTPUT_TOKENS) * rates.tts_output_per_million_usd
    ) / MILLION
    return maximum, {
        "inputTokenCeiling": _TTS_MAX_INPUT_TOKENS,
        "audioOutputTokenCeiling": _TTS_MAX_OUTPUT_TOKENS,
        "voice": request.voice,
    }


def _cloud_tts_maximum(
        request: CloudTtsRequest,
        rates: GoogleGenerationRateSnapshot) -> tuple[Decimal, dict]:
    if (request.model != ModelId.CHIRP_3_HD
            or request.body.get("input") != {"text": request.script}
            or request.body.get("voice") != {
                "languageCode": "es-ES", "name": request.voice}
            or request.body.get("audioConfig") != {"audioEncoding": "MP3"}):
        raise GoogleMaximumUnavailable(
            "La variante Cloud TTS no tiene un máximo cerrado.")
    # Google factura caracteres. Los bytes UTF-8 son un techo conservador para
    # español y coinciden con el límite documentado de la petición.
    character_ceiling = len(request.script.encode("utf-8"))
    maximum = (Decimal(character_ceiling)
               * rates.chirp_per_million_characters_usd / MILLION)
    return maximum, {
        "characterCeilingBytes": character_ceiling,
        "audioEncoding": "MP3",
        "voice": request.voice,
    }


def _generation_maximum(request, rates: GoogleGenerationRateSnapshot
                        ) -> tuple[str, Decimal, dict, str]:
    if isinstance(request, CloudTtsRequest):
        amount, usage = _cloud_tts_maximum(request, rates)
        return "google_cloud_tts_chirp", amount, usage, rates.tts_evidence_sha256
    if isinstance(request, ImageRequest):
        amount, usage = _image_maximum(request, rates)
        return "google_image_generation", amount, usage, rates.pricing_evidence_sha256
    if isinstance(request, VideoRequest) and request.model.startswith("veo-"):
        amount, usage = _veo_maximum(request, rates)
        return "google_veo", amount, usage, rates.pricing_evidence_sha256
    if isinstance(request, VideoRequest):
        amount, usage = _omni_maximum(request, rates)
        return "google_omni", amount, usage, rates.pricing_evidence_sha256
    if isinstance(request, MusicRequest):
        if request.model != ModelId.LYRIA_3:
            raise GoogleMaximumUnavailable("La variante Lyria no tiene un máximo cerrado.")
        return ("google_lyria", rates.lyria_30s_clip_usd,
                {"outputClips": 1, "durationSeconds": 30,
                 "inputImages": len(request.input_manifest)},
                rates.pricing_evidence_sha256)
    if isinstance(request, VoiceoverRequest):
        amount, usage = _voice_maximum(request, rates)
        return "google_tts", amount, usage, rates.tts_evidence_sha256
    raise ValueError("Petición Google sin tarifa cerrada.")


def google_generation_cost_ceiling(
        binding: ExecutionBinding, operation_id: str, request,
        rates: GoogleGenerationRateSnapshot, *, now: datetime) -> CostCeiling:
    """Crea una línea de generación; no completa ni aprueba el presupuesto."""
    _validate_rates(rates, now)
    binding_sha, operation, exact = _operation(binding, operation_id, request)
    service, raw_maximum, usage, evidence_source = _generation_maximum(
        request, rates)
    maximum = _cent(raw_maximum)
    if maximum <= 0:
        raise ValueError("El máximo de generación debe ser positivo.")
    evidence = canonical_sha256({
        "schemaVersion": 1,
        "bindingSha256": binding_sha,
        "operationId": operation.operation_id,
        "requestSha256": exact.sha256,
        "model": exact.model,
        "service": service,
        "usageCeiling": usage,
        "rawMaximumUsd": str(raw_maximum),
        "roundedMaximumUsd": str(maximum),
        "rateEvidenceSha256": evidence_source,
        "checkedAt": rates.checked_at.isoformat(),
        "pricingUrl": (TTS_PRICING_URL
                       if service in {"google_tts", "google_cloud_tts_chirp"}
                       else PRICING_URL),
    })
    cost_id = str(uuid5(
        NAMESPACE_URL,
        f"uonify:{binding_sha}:{operation.operation_id}:{service}"))
    return CostCeiling(
        cost_id, "generation", service, "customer_google_project",
        maximum, binding_sha, evidence, rates.checked_at, rates.expires_at,
        operation.operation_id)
