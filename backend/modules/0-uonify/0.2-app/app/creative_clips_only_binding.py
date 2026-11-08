"""Armado del binding de ejecución para clips-only (W2 del veredicto del contrato, 27-10).

W2 quedó DIFERIDO al armado del binding; esto lo cierra con código (vuelve al Consultor). Toma el
`CreativeExecutionDraft` de vídeo + sus `RequestOperationBinding` (producidos aguas arriba por
`video_request_operations`, no se re-derivan aquí) + el ancla del plan (uony_creative_plans DRAFT) +
los límites 8 s/720p confirmados por el dueño, y produce la `CompositeQuoteReadiness` (su
`binding_sha256` liga la cotización). La readiness alimenta `hold_clips_only_graph`.

Reglas W2 (disciplina de este módulo; `_binding` solo exige strings no vacíos):
  (a) engine name+version NO vacíos;
  (b) descriptor de motor de GENERACIÓN, NUNCA montaje (no photocraft/effectcraft/filmcraft);
  (c) `adapterOperation` ligado a la op `video_generation`, NUNCA craft (image_edit/motion_graphics/
      video_export/image_generation);
  (d) SIN id de modelo CRUDO como nombre de motor (el model-id vive en `operation.model`, interno).
Elección (a verdictar por el Consultor): engine=`clip_generation`, version=`1`, adapterOperation=
`video_generation`. clips-only = SOLO ops `video_generation` (audio nativo de Veo → sin voiceover);
cualquier kind de craft/voiceover se RECHAZA fail-closed.

STAGED + INERTE: función pura; sin red, sin DB, sin llamador. El recipe clips-only (marcador
`clips_only_direct_delivery`, montage:false) aporta el `editRecipeSha256`.
"""
from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from .creative_clips_only_recipe import clips_only_edit_recipe
from .creative_composite_quote import (CompositeQuoteReadiness, CostCeiling,
                                       ExecutionBinding, RequestOperationBinding,
                                       canonical_sha256, composite_quote_readiness)
from .creative_execution_draft import CreativeExecutionDraft

# Descriptor de motor de GENERACIÓN (W2 b/d): ni montaje ni id de modelo crudo.
_ENGINE = 'clip_generation'
_ENGINE_VERSION = '1'
_ADAPTER_OPERATION = 'video_generation'

# Límites iniciales confirmados por el dueño («8 s / 720p para empezar»); ampliar es cambio de
# config que vuelve al Consultor. Fail-closed ante cualquier otro valor.
_ALLOWED_DURATIONS = frozenset({8})
_ALLOWED_RESOLUTIONS = frozenset({'720p'})


class ClipsOnlyBindingError(Exception):
    """Fail-closed: el binding clips-only no liga todas sus fuentes de forma válida."""


@dataclass(frozen=True)
class ClipLimits:
    """Límites del clip que entran en el `limitsSha256` del binding (no es el cuerpo Veo)."""
    duration_seconds: int
    resolution: str

    def payload(self) -> dict:
        return {'schemaVersion': 1, 'maxDurationSeconds': self.duration_seconds,
                'resolution': self.resolution}


def clip_limits(duration_seconds: int, resolution: str) -> ClipLimits:
    """Construye límites válidos (8 s/720p para empezar). Fail-closed."""
    if (not isinstance(duration_seconds, int) or isinstance(duration_seconds, bool)
            or duration_seconds not in _ALLOWED_DURATIONS):
        raise ClipsOnlyBindingError('La duración del clip no está permitida (8 s para empezar).')
    if resolution not in _ALLOWED_RESOLUTIONS:
        raise ClipsOnlyBindingError('La resolución del clip no está permitida (720p para empezar).')
    return ClipLimits(duration_seconds, resolution)


def _uuid(value: object) -> bool:
    try:
        return str(UUID(str(value))) == value
    except (ValueError, TypeError, AttributeError):
        return False


def clips_only_execution_binding(
        draft: CreativeExecutionDraft,
        operations: tuple[RequestOperationBinding, ...], *,
        plan_id: str, plan_revision: int, source_plan_sha256: str,
        input_manifest_sha256: str, limits: ClipLimits) -> ExecutionBinding:
    """Construye y VALIDA el `ExecutionBinding` clips-only (reglas W2), SIN cotizar.

    Extraído de `assemble_clips_only_binding` SIN cambio de comportamiento (misma validación, mismo
    orden, misma construcción): la orquestación necesita el `ExecutionBinding` como OBJETO para
    alimentar los constructores de `CostCeiling` ANTES de cerrar la readiness con esos techos.
    Fail-closed: draft de vídeo, operaciones solo `video_generation`, límites en el allowset 8 s/720p,
    ancla de plan DRAFT válida."""
    if not isinstance(draft, CreativeExecutionDraft) or draft.medium != 'vídeo':
        raise ClipsOnlyBindingError('El draft no es un draft de vídeo válido.')
    if not isinstance(operations, tuple) or not operations:
        raise ClipsOnlyBindingError('El binding clips-only necesita operaciones.')
    for item in operations:
        if not isinstance(item, RequestOperationBinding):
            raise ClipsOnlyBindingError('Operación de petición no válida.')
        if item.kind != _ADAPTER_OPERATION:
            # clips-only = SOLO video_generation (sin montaje ni voiceover; audio nativo de Veo).
            raise ClipsOnlyBindingError(
                'clips-only solo admite operaciones video_generation (sin montaje ni voiceover).')
    if (not isinstance(limits, ClipLimits)
            or limits.duration_seconds not in _ALLOWED_DURATIONS
            or limits.resolution not in _ALLOWED_RESOLUTIONS):
        # Endurecimiento (condición Consultor W2): el binding es el punto AUTORITATIVO (lo que el
        # cliente aprueba), así que re-valida el allowset aquí, no solo en la factory clip_limits().
        # Un ClipLimits(16,'4k') construido a mano (saltándose la factory) NO puede ensamblarse.
        raise ClipsOnlyBindingError(
            'Los límites del clip no están en el allowset autorizado (8 s/720p).')
    if not (_uuid(plan_id) and isinstance(plan_revision, int)
            and not isinstance(plan_revision, bool) and plan_revision >= 1):
        raise ClipsOnlyBindingError('El ancla del plan (DRAFT) no es válida.')
    return ExecutionBinding(
        plan_id, plan_revision, source_plan_sha256, draft.snapshot_sha256,
        canonical_sha256(clips_only_edit_recipe()), input_manifest_sha256,
        draft.request_group_sha256, operations,
        _ENGINE, _ENGINE_VERSION, _ADAPTER_OPERATION,
        canonical_sha256(limits.payload()))


def assemble_clips_only_binding(
        draft: CreativeExecutionDraft,
        operations: tuple[RequestOperationBinding, ...], *,
        plan_id: str, plan_revision: int, source_plan_sha256: str,
        input_manifest_sha256: str, limits: ClipLimits,
        ceilings: tuple[CostCeiling, ...] = ()) -> CompositeQuoteReadiness:
    """Arma el `ExecutionBinding` clips-only y devuelve su `CompositeQuoteReadiness`.

    `operations` las produce `video_request_operations(draft, directed)` aguas arriba. `ceilings`
    (evidencias de coste de la pricing) son opcionales: con () se obtiene el binding_sha256 (quote
    incompleta); con techos reales, la readiness completa para aprobar. El plan (plan_id/revision/
    source_plan_sha256) ancla a la DRAFT de uony_creative_plans; `input_manifest_sha256` es el
    manifiesto de propiedad del input (gate uri+generation+sha256)."""
    binding = clips_only_execution_binding(
        draft, operations, plan_id=plan_id, plan_revision=plan_revision,
        source_plan_sha256=source_plan_sha256,
        input_manifest_sha256=input_manifest_sha256, limits=limits)
    # composite_quote_readiness valida el binding entero (shas, operaciones, orden) fail-closed.
    return composite_quote_readiness(binding, ceilings)
