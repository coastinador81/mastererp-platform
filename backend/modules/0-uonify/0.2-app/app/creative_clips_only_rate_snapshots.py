"""Puerto de inyección de los RATE SNAPSHOTS por CONFIG DE OPERADOR (veredicto Consultor 28-10).

El Consultor cerró el origen del precio: nada de runtime/Catalog API; un SNAPSHOT FRESCO
(checked_at=captura, expires_at≈+23 h, evidence_sha256) capturado de la página pública oficial y
BENDECIDO por el dueño, inyectado SOLO por config de operador — NUNCA del cliente ni del modelo.

Este módulo SOLO construye los dos dataclasses (`GoogleGenerationRateSnapshot` +
`InfrastructureRateSnapshot`) a partir de esa config. NO los valida ni los da por vigentes: el gate
AUTORITATIVO ≤24 h + completitud es `_validate_rates` / el `_validate` de infra, que corren DENTRO de
los constructores de CostCeiling en el momento de cotizar (contra `now`). Aquí es fail-closed de FORMA:
cualquier campo ausente o no convertible ⇒ `(None, None)` ⇒ el composer deja los ceilings vacíos ⇒
readiness incompleta ⇒ «sin precio» (estado defensivo aprobado). No se debilita ningún gate.

Formato del PUERTO (operador rellena `settings.creative_clips_only_rate_snapshots`, un dict):
{
  "checkedAt": "<iso8601 con tz>",          # momento de captura
  "expiresAt": "<iso8601 con tz, ≈ +23 h>", # el gate exige ]now, now+24h]
  "generation": {                            # cifras GoogleGenerationRateSnapshot (TODAS; el gate exige
    "imageInputPerMillionUsd": {"<model>": "x", ...},   #  el snapshot COMPLETO, no solo Veo)
    "imageTextOutputPerMillionUsd": {...}, "image1kOutputUsd": {...},
    "imageInputTokens": {"<model>": 123, ...},
    "veoAudio720pPerSecondUsd": {"veo-3.1-fast-generate-001": "x", ...},
    "omniInputPerMillionUsd": "x", "omniTextOutputPerMillionUsd": "x",
    "omniVideoOutputPerMillionUsd": "x", "omniImageInputTokens": 123,
    "omniVideoInputTokensPerSecond": 123, "omniVideoOutputTokensPerSecond": {"720p": 123, ...},
    "lyria30sClipUsd": "x", "ttsInputPerMillionUsd": "x", "ttsOutputPerMillionUsd": "x",
    "chirpPerMillionCharactersUsd": "x",
    "pricingEvidenceSha256": "<64hex>", "ttsEvidenceSha256": "<64hex>"
  },
  "infrastructure": {                        # cifras InfrastructureRateSnapshot
    "location": "us-central1", "storageGibMonthUsd": "x", "classAPer1000Usd": "x",
    "classBPer1000Usd": "x", "transferGibUsd": "x", "transcoderHdMinuteUsd": "x",
    "storageEvidenceSha256": "<64hex>", "transcoderEvidenceSha256": "<64hex>",
    "craftEvidenceSha256": "<64hex>"
  }
}
Los dos snapshots COMPARTEN checkedAt/expiresAt (una captura = una ventana de frescura).
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation

from .creative_google_generation_costs import GoogleGenerationRateSnapshot
from .creative_infrastructure_costs import InfrastructureRateSnapshot

_RATE_SNAPSHOT_SETTING = 'creative_clips_only_rate_snapshots'


def _dec(value) -> Decimal:
    parsed = Decimal(str(value))
    if not parsed.is_finite():
        raise InvalidOperation('tarifa no finita')
    return parsed


def _dec_map(value) -> dict:
    return {str(k): _dec(v) for k, v in dict(value).items()}


def _int_map(value) -> dict:
    out = {}
    for k, v in dict(value).items():
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError('token no entero')
        out[str(k)] = v
    return out


def _int(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError('token no entero')
    return value


def _instant(value) -> datetime:
    parsed = datetime.fromisoformat(str(value))
    if parsed.tzinfo is None:
        raise ValueError('fecha sin zona horaria')
    return parsed


def clips_only_operator_rate_snapshots(
        settings, *, now: datetime
        ) -> tuple[GoogleGenerationRateSnapshot | None,
                   InfrastructureRateSnapshot | None]:
    """Construye los dos snapshots desde la config de operador, o `(None, None)` fail-closed.

    `now` no se usa aquí (el gate de frescura ≤24 h es `_validate_rates`, aguas abajo, contra `now`);
    se acepta por simetría y para futuras comprobaciones de forma. Fail-closed de forma: sin config, o
    cualquier campo ausente/no convertible ⇒ `(None, None)` ⇒ «sin precio»."""
    config = getattr(settings, _RATE_SNAPSHOT_SETTING, None)
    if not isinstance(config, dict):
        return None, None
    try:
        checked_at = _instant(config['checkedAt'])
        expires_at = _instant(config['expiresAt'])
        g = config['generation']
        i = config['infrastructure']
        generation = GoogleGenerationRateSnapshot(
            image_input_per_million_usd=_dec_map(g['imageInputPerMillionUsd']),
            image_text_output_per_million_usd=_dec_map(g['imageTextOutputPerMillionUsd']),
            image_1k_output_usd=_dec_map(g['image1kOutputUsd']),
            image_input_tokens=_int_map(g['imageInputTokens']),
            veo_audio_720p_per_second_usd=_dec_map(g['veoAudio720pPerSecondUsd']),
            omni_input_per_million_usd=_dec(g['omniInputPerMillionUsd']),
            omni_text_output_per_million_usd=_dec(g['omniTextOutputPerMillionUsd']),
            omni_video_output_per_million_usd=_dec(g['omniVideoOutputPerMillionUsd']),
            omni_image_input_tokens=_int(g['omniImageInputTokens']),
            omni_video_input_tokens_per_second=_int(g['omniVideoInputTokensPerSecond']),
            omni_video_output_tokens_per_second=_int_map(g['omniVideoOutputTokensPerSecond']),
            lyria_30s_clip_usd=_dec(g['lyria30sClipUsd']),
            tts_input_per_million_usd=_dec(g['ttsInputPerMillionUsd']),
            tts_output_per_million_usd=_dec(g['ttsOutputPerMillionUsd']),
            chirp_per_million_characters_usd=_dec(g['chirpPerMillionCharactersUsd']),
            pricing_evidence_sha256=str(g['pricingEvidenceSha256']),
            tts_evidence_sha256=str(g['ttsEvidenceSha256']),
            checked_at=checked_at, expires_at=expires_at)
        infrastructure = InfrastructureRateSnapshot(
            location=str(i['location']),
            storage_gib_month_usd=_dec(i['storageGibMonthUsd']),
            class_a_per_1000_usd=_dec(i['classAPer1000Usd']),
            class_b_per_1000_usd=_dec(i['classBPer1000Usd']),
            transfer_gib_usd=_dec(i['transferGibUsd']),
            transcoder_hd_minute_usd=_dec(i['transcoderHdMinuteUsd']),
            storage_evidence_sha256=str(i['storageEvidenceSha256']),
            transcoder_evidence_sha256=str(i['transcoderEvidenceSha256']),
            craft_evidence_sha256=str(i['craftEvidenceSha256']),
            checked_at=checked_at, expires_at=expires_at)
    except (KeyError, TypeError, ValueError, InvalidOperation):
        return None, None
    return generation, infrastructure
