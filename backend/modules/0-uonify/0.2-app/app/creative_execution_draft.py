"""Snapshot inmutable previo a cotización/aprobación; no abre ningún gate."""

from dataclasses import dataclass
from decimal import Decimal
from hashlib import sha256
import json

from .creative_batch_pricing import BatchPricingReadiness
from .creative_image_direction import DirectedImagePlan
from .creative_pricing_readiness import PricingReadiness, pricing_readiness
from .creative_request_fingerprint import fingerprint
from .creative_strategy_contract import StrategyBinding
from .creative_video_direction import DirectedVideoBatch


@dataclass(frozen=True)
class CreativeExecutionDraft:
    schema_version: int
    medium: str
    project: str
    recipe: str
    model: str
    skill_version: str
    skill_source_sha256: str
    strategy_sha256: str
    request_hashes: tuple[str, ...]
    request_group_sha256: str
    known_generation_component_usd: Decimal
    currency: str
    complete_maximum_usd: Decimal | None
    missing_for_maximum: tuple[str, ...]
    snapshot_sha256: str
    ready_for_quote: bool = False
    approval_ready: bool = False
    execution_authorized: bool = False


def _canonical(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False)


def _finish(value: dict, amount: Decimal, missing: tuple[str, ...]
            ) -> CreativeExecutionDraft:
    snapshot = _canonical({**value, 'knownGenerationComponentUsd': str(amount),
                           'currency': 'USD',
                           'completeMaximumUsd': None,
                           'missingForMaximum': missing})
    return CreativeExecutionDraft(
        1, value['medium'], value['project'], value['recipe'], value['model'],
        value['skillVersion'], value['skillSourceSha256'],
        value['strategySha256'], tuple(value['requestHashes']),
        value['requestGroupSha256'], amount, 'USD', None, missing,
        sha256(snapshot.encode()).hexdigest())


def video_execution_draft(
        strategy: StrategyBinding,
        directed: DirectedVideoBatch,
        pricing: BatchPricingReadiness,
        ) -> CreativeExecutionDraft:
    if not isinstance(strategy, StrategyBinding) or not strategy.strategy_ready:
        raise ValueError('La estrategia de vídeo no está lista.')
    if not isinstance(directed, DirectedVideoBatch):
        raise ValueError('El lote dirigido no es válido.')
    if not isinstance(pricing, BatchPricingReadiness):
        raise ValueError('La preparación de precio del lote no es válida.')
    video_hashes = tuple(fingerprint(item).sha256 for item in directed.batch.requests)
    voice_hashes = tuple(fingerprint(item.request).sha256
                         for item in directed.voiceovers)
    if (video_hashes != directed.batch.request_hashes
            or any(item.request_sha256 != request_hash
                   for item, request_hash in zip(directed.voiceovers, voice_hashes))
            or pricing.batch_sha256 != directed.batch.batch_sha256
            or tuple(item.request_sha256 for item in pricing.components) != video_hashes):
        raise ValueError('El lote o su preparación de precio cambiaron.')
    if (strategy.skill_version != directed.skill_version
            or strategy.skill_source_sha256 != directed.skill_source_sha256
            or strategy.strategy_sha256 != directed.strategy_sha256):
        raise ValueError('La estrategia y el lote no usan la misma versión del skill.')
    voice_prices = tuple(pricing_readiness(item.request)
                         for item in directed.voiceovers)
    if any(item.known_generation_usd is None for item in voice_prices):
        raise ValueError('Falta el techo publicado de la voz TTS.')
    missing = tuple(dict.fromkeys((
        *pricing.missing_for_maximum,
        *(value for item in voice_prices for value in item.missing_for_maximum),
        'claim durable del intento y cierre succeeded/failed/unknown',
        'ownership, revisión y generación física de cada asset',
    )))
    hashes = video_hashes + voice_hashes
    group_hash = (directed.batch.batch_sha256 if not voice_hashes else
                  sha256(_canonical({
                      'videoBatchSha256': directed.batch.batch_sha256,
                      'voiceoverRequestHashes': voice_hashes,
                  }).encode()).hexdigest())
    return _finish({
        'schemaVersion': 1, 'medium': 'vídeo',
        'project': directed.batch.project, 'recipe': strategy.recipe,
        'model': directed.batch.model, 'skillVersion': directed.skill_version,
        'skillSourceSha256': directed.skill_source_sha256,
        'strategySha256': strategy.strategy_sha256,
        'requestHashes': hashes,
        'requestGroupSha256': group_hash,
        'videoBatchSha256': directed.batch.batch_sha256,
        'voiceoverUnits': tuple(item.unit_id for item in directed.voiceovers),
        'requestedSeconds': directed.batch.requested_seconds,
        'generatedSeconds': directed.batch.generated_seconds,
        'trimSeconds': directed.batch.trim_seconds,
    }, pricing.known_generation_component_usd + sum(
        (item.known_generation_usd for item in voice_prices), Decimal(0)), missing)


def image_execution_draft(
        strategy: StrategyBinding,
        directed: DirectedImagePlan,
        pricing: PricingReadiness,
        ) -> CreativeExecutionDraft:
    if not isinstance(strategy, StrategyBinding) or not strategy.strategy_ready:
        raise ValueError('La estrategia de imagen no está lista.')
    if not isinstance(directed, DirectedImagePlan):
        raise ValueError('El plan dirigido de imagen no es válido.')
    if not isinstance(pricing, PricingReadiness) or pricing.known_generation_usd is None:
        raise ValueError('La preparación de precio de imagen no es válida.')
    request_hash = fingerprint(directed.request).sha256
    direction_hash = sha256(_canonical(
        directed.direction.model_dump(mode='json')).encode()).hexdigest()
    if (request_hash != directed.request_sha256
            or direction_hash != directed.direction_sha256
            or pricing.model != directed.request.model):
        raise ValueError('La solicitud de imagen o su precio cambiaron.')
    if (strategy.skill_version != directed.skill_version
            or strategy.skill_source_sha256 != directed.skill_source_sha256
            or strategy.strategy_sha256 != directed.strategy_sha256):
        raise ValueError('La estrategia y la imagen no corresponden.')
    group = sha256(_canonical({'requests': [request_hash],
                               'directionSha256': directed.direction_sha256}
                              ).encode()).hexdigest()
    missing = tuple(dict.fromkeys((
        *pricing.missing_for_maximum,
        'claim durable del intento y cierre succeeded/failed/unknown',
        'asset final con ownership, revisión y recibo de almacenamiento',
    )))
    return _finish({
        'schemaVersion': 1, 'medium': 'imagen',
        'project': directed.request.endpoint.split('/projects/', 1)[1].split('/', 1)[0],
        'recipe': strategy.recipe, 'model': directed.request.model,
        'skillVersion': directed.skill_version,
        'skillSourceSha256': directed.skill_source_sha256,
        'strategySha256': strategy.strategy_sha256,
        'requestHashes': (request_hash,), 'requestGroupSha256': group,
        'directionSha256': directed.direction_sha256,
        'aspectRatio': directed.direction.aspectRatio,
        'copyRoles': tuple(item.role for item in directed.direction.copyManifest),
    }, pricing.known_generation_usd, missing)
