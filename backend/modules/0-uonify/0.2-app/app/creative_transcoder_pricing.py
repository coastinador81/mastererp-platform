"""Techo conservador para el único output HD opcional de Transcoder."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_CEILING
import re

from .creative_composite_quote import canonical_sha256
from .creative_transcoder_contracts import TranscoderJobRequest


PRICING_URL = "https://cloud.google.com/transcoder/pricing"
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_CENT = Decimal("0.01")


@dataclass(frozen=True)
class TranscoderRateSnapshot:
    hd_per_minute_usd: Decimal
    pricing_evidence_sha256: str
    checked_at: datetime
    expires_at: datetime


@dataclass(frozen=True)
class TranscoderMaximum:
    maximum_usd: Decimal
    snapshot: dict
    sha256: str
    approval_ready: bool = False


def _rate(value: TranscoderRateSnapshot, now: datetime) -> None:
    if (not isinstance(value, TranscoderRateSnapshot)
            or not isinstance(value.hd_per_minute_usd, Decimal)
            or not value.hd_per_minute_usd.is_finite()
            or value.hd_per_minute_usd <= 0
            or value.hd_per_minute_usd.as_tuple().exponent < -6
            or not _HASH.fullmatch(value.pricing_evidence_sha256)
            or not isinstance(now, datetime) or not now.tzinfo
            or not value.checked_at.tzinfo or not value.expires_at.tzinfo
            or value.checked_at > now
            or now - value.checked_at > timedelta(days=1)
            or value.expires_at <= now
            or value.expires_at > now + timedelta(days=1)):
        raise ValueError("La tarifa Transcoder no está vigente.")


def _request(value: TranscoderJobRequest) -> None:
    if not isinstance(value, TranscoderJobRequest):
        raise ValueError("La petición Transcoder no es presupuestable.")
    config = value.body.get("config") if isinstance(value.body, dict) else None
    if not isinstance(config, dict) or set(config) != {
            "inputs", "output", "elementaryStreams", "muxStreams"}:
        raise ValueError("La petición Transcoder no es presupuestable.")
    streams = config.get("elementaryStreams")
    mux = config.get("muxStreams")
    inputs = config.get("inputs")
    output = config.get("output")
    if (not isinstance(streams, list) or len(streams) != 2
            or any(not isinstance(item, dict) for item in streams)
            or not isinstance(mux, list) or len(mux) != 1
            or not isinstance(mux[0], dict)
            or not isinstance(inputs, list) or len(inputs) != 1
            or not isinstance(inputs[0], dict)
            or set(inputs[0]) != {"key", "uri"}
            or inputs[0].get("key") != "input0"
            or not isinstance(inputs[0].get("uri"), str)
            or not inputs[0]["uri"].startswith("gs://")
            or output != {"uri": value.output_prefix}
            or not re.fullmatch(
                r"https://transcoder\.googleapis\.com/v1/projects/"
                r"[a-z][a-z0-9-]{4,61}[a-z0-9]/locations/"
                r"europe-west1/jobs", value.endpoint)
            or not _HASH.fullmatch(value.input_sha256)
            or not isinstance(value.input_generation, int)
            or isinstance(value.input_generation, bool)
            or value.input_generation <= 0
            or not value.output_prefix.startswith(
                f"gs://{inputs[0]['uri'][5:].split('/', 1)[0]}/"
                f"creative/users/{value.owner_id}/exports/")):
        raise ValueError("La petición Transcoder no es presupuestable.")
    expected_streams = [
        {"key": "video0", "videoStream": {"h264": {
            "widthPixels": 1280, "heightPixels": 720,
            "frameRate": 30, "bitrateBps": 2500000}}},
        {"key": "audio0", "audioStream": {
            "codec": "aac", "bitrateBps": 128000}},
    ]
    expected_mux = [{
        "key": "final", "fileName": value.expected_filename,
        "container": "mp4", "elementaryStreams": ["video0", "audio0"],
    }]
    if (streams != expected_streams or mux != expected_mux
            or not isinstance(value.duration_seconds, (int, float))
            or isinstance(value.duration_seconds, bool)
            or value.duration_seconds < 5):
        raise ValueError("La petición Transcoder no es presupuestable.")


def transcoder_hd_maximum(
        request: TranscoderJobRequest, rates: TranscoderRateSnapshot, *,
        now: datetime) -> TranscoderMaximum:
    """Redondea duración al minuto superior para no subestimar el máximo."""
    _rate(rates, now)
    _request(request)
    billed_minutes = (
        Decimal(str(request.duration_seconds)) / Decimal(60)
    ).to_integral_value(rounding=ROUND_CEILING)
    maximum = (billed_minutes * rates.hd_per_minute_usd).quantize(
        _CENT, rounding=ROUND_CEILING)
    snapshot = {
        "schemaVersion": 1,
        "kind": "google_transcoder_hd_maximum",
        "maximumUsd": str(maximum),
        "billableMinuteCeiling": int(billed_minutes),
        "sourceDurationSeconds": str(request.duration_seconds),
        "output": {"widthPixels": 1280, "heightPixels": 720,
                   "fileName": request.expected_filename},
        "ownerId": request.owner_id,
        "inputSha256": request.input_sha256,
        "inputGeneration": request.input_generation,
        "outputPrefix": request.output_prefix,
        "rateUsdPerMinute": str(rates.hd_per_minute_usd),
        "pricingEvidenceSha256": rates.pricing_evidence_sha256,
        "pricingUrl": PRICING_URL,
        "approvalReady": False,
    }
    return TranscoderMaximum(
        maximum, snapshot, canonical_sha256(snapshot))
