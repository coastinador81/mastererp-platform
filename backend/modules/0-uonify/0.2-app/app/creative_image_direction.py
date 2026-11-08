"""Dirección de estáticos y finishing controlado, sin ejecutar generación."""

from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Literal

from pydantic import Field, model_validator

from .creative_image_contracts import ImageOutput, ImageRequest, image_dimensions, image_request
from .creative_planning import AUDITED_PROJECT, COMMERCIAL_RECIPES
from .creative_request_fingerprint import fingerprint
from .creative_skill_compiler import SkillCompilation
from .creative_strategy_contract import (StrategyBinding, StrategyContext,
                                          bind_strategy)
from .onboarding import StrictBody


class CopyLayer(StrictBody):
    role: Literal['headline', 'supporting', 'price', 'terms', 'cta']
    exactText: str = Field(min_length=1, max_length=240)
    destination: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def valid(self):
        if self.role == 'cta' and not self.destination:
            raise ValueError('La CTA necesita el destino real.')
        if self.role != 'cta' and self.destination:
            raise ValueError('Solo la CTA contiene destino.')
        return self


class StaticDirection(StrictBody):
    unitId: Literal['image-01']
    assetPurpose: Literal['final_static', 'product_plate', 'location_plate',
                          'character_reference', 'video_start_frame']
    placement: str = Field(min_length=3, max_length=160)
    aspectRatio: Literal['1:1']
    primaryVisual: str = Field(min_length=8, max_length=500)
    hierarchy: str = Field(min_length=8, max_length=500)
    photography: str = Field(min_length=8, max_length=700)
    motivatedLight: str = Field(min_length=8, max_length=400)
    occupancy: str = Field(min_length=3, max_length=300)
    copySpace: str = Field(min_length=8, max_length=300)
    copyManifest: list[CopyLayer] = Field(default_factory=list, max_length=5)

    @model_validator(mode='after')
    def valid(self):
        roles = [item.role for item in self.copyManifest]
        if len(roles) != len(set(roles)):
            raise ValueError('Cada capa de copy debe tener una función única.')
        return self


@dataclass(frozen=True)
class DirectedImagePlan:
    skill_version: str
    skill_source_sha256: str
    strategy_sha256: str
    direction: StaticDirection
    direction_sha256: str
    request: ImageRequest
    request_sha256: str
    human_checks: tuple[str, ...]
    approval_ready: bool = False
    execution_authorized: bool = False


@dataclass(frozen=True)
class ImageEvaluation:
    request_sha256: str
    automatic_passed: bool
    automatic_issues: tuple[str, ...]
    human_checks: tuple[str, ...]
    human_review_required: bool = True
    accepted_for_use: bool = False


def _prompt(direction: StaticDirection) -> str:
    return (
        f'Asset purpose: {direction.assetPurpose.replace("_", " ")}. '
        f'Placement: {direction.placement.strip()}, square 1:1. '
        f'Primary visual: {direction.primaryVisual.strip()}. '
        f'Hierarchy: {direction.hierarchy.strip()}. '
        f'Photography: {direction.photography.strip()}. '
        f'Motivated light: {direction.motivatedLight.strip()}. '
        f'Occupancy: {direction.occupancy.strip()}. '
        f'Preserve copy space: {direction.copySpace.strip()}. '
        'Generate the photographic layer only. Do not generate headlines, prices, '
        'terms, CTA, badges, interface states, testimonials or decorative pseudo-text. '
        'Preserve plausible support, contact shadows, reflections, anatomy, local '
        'color and product geometry; do not invent brands or unsupported features.')


def _checks(direction: StaticDirection) -> tuple[str, ...]:
    checks = [
        'El visual principal y la evidencia dominan a tamaño de publicación.',
        'Producto, persona, espacio, apoyo, sombras y reflejos son coherentes.',
        'No aparecen características, marcas, prueba o interfaces inventadas.',
        'El recorte 1:1 conserva el sujeto y el espacio de copy previsto.',
        'La iluminación y el color local corresponden a las fuentes descritas.',
    ]
    for layer in direction.copyManifest:
        checks.append(f'La capa {layer.role} reproduce exactamente: {layer.exactText}')
    return tuple(checks)


def compile_directed_image(
        compilation: SkillCompilation,
        strategy: StrategyBinding,
        context: StrategyContext | dict,
        direction: StaticDirection | dict, *,
        project: str,
        ) -> DirectedImagePlan:
    """Compila la placa fotográfica y conserva el copy para montaje determinista."""
    if (not isinstance(compilation, SkillCompilation)
            or compilation.medium != 'imagen' or not compilation.request_compile_ready):
        raise ValueError('El plan todavía no permite compilar una imagen.')
    if project != AUDITED_PROJECT:
        raise ValueError('El proyecto Google no coincide con la capacidad auditada.')
    rebound = bind_strategy(compilation, context)
    if (not isinstance(strategy, StrategyBinding) or not strategy.strategy_ready
            or strategy.strategy_sha256 != rebound.strategy_sha256):
        raise ValueError('La estrategia no está lista o cambió desde su validación.')
    parsed = (direction if isinstance(direction, StaticDirection)
              else StaticDirection.model_validate(direction))
    expected = compilation.units[0].unit_id
    if parsed.unitId != expected:
        raise ValueError('La dirección no corresponde a la unidad de imagen.')
    if compilation.recipe in COMMERCIAL_RECIPES:
        ctas = [item for item in parsed.copyManifest if item.role == 'cta']
        context_value = (context if isinstance(context, StrategyContext)
                         else StrategyContext.model_validate(context))
        if len(ctas) != 1 or ctas[0].destination != context_value.destination:
            raise ValueError('La CTA y su destino deben coincidir con la estrategia.')
    request = image_request(project, compilation.model, _prompt(parsed))
    direction_sha = sha256(json.dumps(
        parsed.model_dump(mode='json'), ensure_ascii=False, sort_keys=True,
        separators=(',', ':'), allow_nan=False).encode()).hexdigest()
    return DirectedImagePlan(
        compilation.source_skill_version, compilation.source_sha256,
        strategy.strategy_sha256, parsed, direction_sha, request,
        fingerprint(request).sha256, _checks(parsed))


def evaluate_directed_image(plan: DirectedImagePlan,
                            output: ImageOutput) -> ImageEvaluation:
    if not isinstance(plan, DirectedImagePlan) or not isinstance(output, ImageOutput):
        raise ValueError('Plan o salida de imagen no válidos.')
    if fingerprint(plan.request).sha256 != plan.request_sha256:
        raise ValueError('La solicitud de imagen cambió desde su compilación.')
    issues = []
    try:
        width, height = image_dimensions(output.data, output.mime_type)
    except (TypeError, ValueError):
        return ImageEvaluation(plan.request_sha256, False,
                               ('bytes de imagen no verificables',), plan.human_checks)
    if sha256(output.data).hexdigest() != output.sha256:
        issues.append('SHA-256 declarado no coincide con los bytes')
    if (width, height) != (output.width_pixels, output.height_pixels):
        issues.append('dimensiones declaradas no coinciden con los bytes')
    if width != height:
        issues.append('la salida no conserva la relación 1:1')
    if width < 1024 or height < 1024:
        issues.append('la salida es inferior al tamaño 1K solicitado')
    return ImageEvaluation(plan.request_sha256, not issues, tuple(issues),
                           plan.human_checks)
