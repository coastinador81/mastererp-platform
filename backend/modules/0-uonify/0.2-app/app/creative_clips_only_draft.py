"""Draft de ejecución CLIPS-ONLY (variante (B): SIN StrategyBinding) — staged + inerte.

`video_execution_draft` (creative_execution_draft.py) EXIGE un `StrategyBinding` (`strategy_ready`,
y valida `strategy.skill_version/skill_source_sha256/strategy_sha256 == directed.*`). El clip simple
«animar la foto» NO tiene estrategia de marketing (fabricar un StrategyContext sería contenido
sintético, categoría vetada; decisión de ArtCraft, sub-fork (B)). Este builder es el ESPEJO EXACTO de
`video_execution_draft` para el caso clips-only:
  * toma `directed.strategy_sha256` DIRECTO (hash canónico de la dirección de ArtCraft), sin
    `StrategyBinding`;
  * `recipe` = el marcador clips-only (`clips_only_direct_delivery`, montage:false), no una receta ART-02;
  * clips-only es SIN VOZ: exige `directed.voiceovers == ()` (fail-closed) y no añade techos de TTS;
  * reusa `_finish`/`_canonical` del módulo compartido para que el `snapshot_sha256` tenga el MISMO
    formato canónico que un draft de vídeo (byte-idéntico; reuso > copia para no derivar).

NO toca `creative_execution_draft.py` (lo usa el montaje) → cero regresión en el camino compartido.
Función PURA: sin red, sin DB, sin llamador (la orquestación clips-only lo invoca). No abre ningún gate
(`ready_for_quote=False`, `execution_authorized=False`, igual que `video_execution_draft`).
"""
from __future__ import annotations

from .creative_batch_pricing import BatchPricingReadiness
from .creative_clips_only_recipe import clips_only_edit_recipe
from .creative_execution_draft import (CreativeExecutionDraft, _canonical,
                                        _finish, fingerprint)
from .creative_video_direction import DirectedVideoBatch


class ClipsOnlyDraftError(ValueError):
    """El lote dirigido clips-only o su preparación de precio no son válidos."""


def _clips_only_draft_value(directed: DirectedVideoBatch,
                            pricing: BatchPricingReadiness):
    """Valida (directed, pricing) y construye `(value, amount, missing)` del draft clips-only.

    Fuente ÚNICA del `value`: la consumen `clips_only_video_draft` (→`_finish`) y
    `clips_only_execution_snapshot_json` (→`_canonical`), de modo que el draft y su snapshot JSON
    SIEMPRE derivan del MISMO dict (sin drift). Espejo de `video_execution_draft` sin StrategyBinding
    ni voz."""
    if not isinstance(directed, DirectedVideoBatch):
        raise ClipsOnlyDraftError('El lote dirigido clips-only no es válido.')
    if not isinstance(pricing, BatchPricingReadiness):
        raise ClipsOnlyDraftError('La preparación de precio del lote no es válida.')
    # Clips-only = SIN VOZ (audio nativo de Veo). Un voiceover aquí es un error de armado.
    if directed.voiceovers != ():
        raise ClipsOnlyDraftError('clips-only no admite voiceovers (audio nativo de Veo).')
    # (B): hace falta el hash de la dirección como strategy_sha256 (no StrategyBinding).
    if not isinstance(directed.strategy_sha256, str) or not directed.strategy_sha256:
        raise ClipsOnlyDraftError('Falta el hash de la dirección clips-only (strategy_sha256).')
    # Re-huella del lote contra la dirección y el precio (idéntico a video_execution_draft).
    video_hashes = tuple(fingerprint(item).sha256 for item in directed.batch.requests)
    if (video_hashes != directed.batch.request_hashes
            or pricing.batch_sha256 != directed.batch.batch_sha256
            or tuple(item.request_sha256 for item in pricing.components) != video_hashes):
        raise ClipsOnlyDraftError('El lote o su preparación de precio cambiaron.')
    missing = tuple(dict.fromkeys((
        *pricing.missing_for_maximum,
        'claim durable del intento y cierre succeeded/failed/unknown',
        'ownership, revisión y generación física de cada asset',
    )))
    value = {
        'schemaVersion': 1, 'medium': 'vídeo',
        'project': directed.batch.project,
        'recipe': clips_only_edit_recipe()['kind'],
        'model': directed.batch.model, 'skillVersion': directed.skill_version,
        'skillSourceSha256': directed.skill_source_sha256,
        'strategySha256': directed.strategy_sha256,
        'requestHashes': video_hashes,
        'requestGroupSha256': directed.batch.batch_sha256,
        'videoBatchSha256': directed.batch.batch_sha256,
        'voiceoverUnits': (),
        'requestedSeconds': directed.batch.requested_seconds,
        'generatedSeconds': directed.batch.generated_seconds,
        'trimSeconds': directed.batch.trim_seconds,
    }
    return value, pricing.known_generation_component_usd, missing


def clips_only_video_draft(directed: DirectedVideoBatch,
                           pricing: BatchPricingReadiness
                           ) -> CreativeExecutionDraft:
    """Draft clips-only desde el `DirectedVideoBatch` de ArtCraft + el precio del lote.

    `video_request_operations(draft, directed)` aguas abajo compara
    project/model/skill_version/skill_source_sha256/request_hashes draft↔directed, que aquí se copian
    de `directed`, de modo que ligan.
    """
    value, amount, missing = _clips_only_draft_value(directed, pricing)
    return _finish(value, amount, missing)


def clips_only_execution_snapshot_json(directed: DirectedVideoBatch,
                                       pricing: BatchPricingReadiness) -> str:
    """El `execution_snapshot_json` persistente cuyo `canonical_sha256` == `draft.snapshot_sha256`.

    `ExecutionPersistenceSnapshots.execution_snapshot_json` DEBE ser el canonical JSON que `_finish`
    hasheó para fijar `draft.snapshot_sha256` (pero `_finish` solo devuelve el sha, no el string).
    Aquí se reproduce EXACTAMENTE ese string reusando `_canonical` sobre el MISMO `value`/amount/missing
    → hash idéntico por construcción. `_persistence_snapshots` (ledger) RECHAZA fail-closed si no casa,
    así que un drift futuro falla en persistencia, no silenciosamente."""
    value, amount, missing = _clips_only_draft_value(directed, pricing)
    return _canonical({**value, 'knownGenerationComponentUsd': str(amount),
                       'currency': 'USD', 'completeMaximumUsd': None,
                       'missingForMaximum': missing})
