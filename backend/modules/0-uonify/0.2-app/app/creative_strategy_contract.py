"""Liga estrategia y evidencia al skill compilado, sin inventarlas ni ejecutar."""

from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Literal

from pydantic import Field, model_validator

from .creative_planning import COMMERCIAL_RECIPES
from .creative_skill_compiler import SkillCompilation
from .onboarding import StrictBody


class ClaimEvidence(StrictBody):
    claimId: str = Field(pattern=r'^claim-[0-9]{2}$')
    statement: str = Field(min_length=5, max_length=400)
    basis: Literal['observed', 'user_provided', 'inference', 'proposal']
    sourceRef: str | None = Field(default=None, max_length=500)
    allowedInMedia: bool = False

    @model_validator(mode='after')
    def valid(self):
        if self.basis in ('observed', 'user_provided') and not self.sourceRef:
            raise ValueError('La afirmación factual necesita una fuente trazable.')
        if self.basis in ('inference', 'proposal') and self.allowedInMedia:
            raise ValueError('Una inferencia o propuesta no puede publicarse como hecho.')
        return self


class StrategyBeat(StrictBody):
    unitId: str = Field(pattern=r'^(?:shot|image)-[0-9]{2}$')
    buyerQuestion: str = Field(min_length=5, max_length=300)
    newInformation: str = Field(min_length=5, max_length=400)
    proofAction: str | None = Field(default=None, max_length=400)
    claimIds: list[str] = Field(default_factory=list, max_length=8)
    ctaTiming: str | None = Field(default=None, max_length=200)

    @model_validator(mode='after')
    def valid(self):
        if len(self.claimIds) != len(set(self.claimIds)):
            raise ValueError('Una toma no puede repetir la misma afirmación.')
        if any(not value.startswith('claim-') for value in self.claimIds):
            raise ValueError('Referencia de afirmación no válida.')
        return self


class StrategyContext(StrictBody):
    purchaseSituation: str = Field(min_length=8, max_length=400)
    motivation: str = Field(min_length=8, max_length=400)
    objection: str = Field(min_length=8, max_length=400)
    persuasionIdea: str = Field(min_length=8, max_length=400)
    hypothesis: str = Field(min_length=8, max_length=500)
    destination: str | None = Field(default=None, max_length=500)
    primaryMetric: Literal['watch_time', 'click_through', 'qualified_lead',
                           'add_to_cart', 'purchase']
    claims: list[ClaimEvidence] = Field(default_factory=list, max_length=24)
    beats: list[StrategyBeat] = Field(min_length=1, max_length=60)
    excludedClaims: list[str] = Field(default_factory=list, max_length=24)


@dataclass(frozen=True)
class StrategyBinding:
    skill_version: str
    skill_source_sha256: str
    recipe: str
    strategy_sha256: str
    blockers: tuple[str, ...]
    strategy_ready: bool
    execution_authorized: bool = False


def bind_strategy(compilation: SkillCompilation,
                  value: StrategyContext | dict) -> StrategyBinding:
    """Valida una estrategia aportada; nunca redacta claims ni rellena evidencia."""
    if not isinstance(compilation, SkillCompilation):
        raise ValueError('Compilación creativa no válida.')
    context = (value if isinstance(value, StrategyContext)
               else StrategyContext.model_validate(value))
    if not compilation.units:
        raise ValueError('El plan no contiene unidades a las que ligar estrategia.')
    expected = tuple(item.unit_id for item in compilation.units)
    received = tuple(item.unitId for item in context.beats)
    if received != expected or len(set(received)) != len(received):
        raise ValueError('La estrategia no corresponde exactamente a las unidades.')
    claims = {item.claimId: item for item in context.claims}
    if len(claims) != len(context.claims):
        raise ValueError('Los identificadores de afirmación deben ser únicos.')
    blockers = list(compilation.plan_blockers)
    commercial = compilation.recipe in COMMERCIAL_RECIPES
    for beat in context.beats:
        for claim_id in beat.claimIds:
            claim = claims.get(claim_id)
            if claim is None:
                blockers.append(f'{beat.unitId}: vincular {claim_id} a evidencia')
            elif not claim.allowedInMedia:
                blockers.append(f'{beat.unitId}: {claim_id} no está autorizado en medios')
        if commercial and not beat.proofAction:
            blockers.append(f'{beat.unitId}: definir una acción o soporte de prueba')
    if commercial:
        if not context.destination:
            blockers.append('definir destino real del CTA')
        if not any(beat.ctaTiming for beat in context.beats):
            blockers.append('ubicar el CTA en una unidad concreta')
        if not any(claim.allowedInMedia for claim in context.claims):
            blockers.append('vincular al menos una afirmación publicable y trazable')
    if compilation.recipe in ('review_card', 'case_study') and not any(
            claim.allowedInMedia and claim.basis in ('observed', 'user_provided')
            for claim in context.claims):
        blockers.append('la reseña o caso necesita prueba factual auténtica')
    unique = tuple(dict.fromkeys(blockers))
    canonical = json.dumps({
        'skillVersion': compilation.source_skill_version,
        'sourceSha256': compilation.source_sha256,
        'recipe': compilation.recipe,
        'context': context.model_dump(mode='json'),
    }, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    ready = compilation.request_compile_ready and not unique
    return StrategyBinding(
        compilation.source_skill_version, compilation.source_sha256,
        compilation.recipe, sha256(canonical.encode()).hexdigest(), unique, ready)
