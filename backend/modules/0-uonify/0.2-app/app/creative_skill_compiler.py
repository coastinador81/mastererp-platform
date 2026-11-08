"""Compila un borrador Higgsfield→Google en unidades revisables, sin ejecutar.

La fuente privada aporta disciplina creativa. Este adaptador usa únicamente las
capacidades Google observadas en Uonify y nunca convierte un plan en aprobación,
reserva o llamada remota.
"""

from dataclasses import dataclass

from .creative_planning import (AUDITED_PROJECT, COMMERCIAL_RECIPES,
                                RECIPES, SKILL_VERSION, SOURCE_SHA256,
                                PlanInput, route)
from .creative_shot_allocation import shot_allocation


@dataclass(frozen=True)
class GenerationUnit:
    unit_id: str
    medium: str
    model: str
    mode: str
    start_seconds: int
    end_seconds: int
    generated_seconds: int
    commercial_job: str
    reference_requirements: tuple[str, ...]
    finishing: tuple[str, ...]


@dataclass(frozen=True)
class SkillCompilation:
    source_skill_version: str
    source_sha256: str
    recipe: str
    medium: str
    model: str
    model_selection: str
    requested_seconds: int | None
    generated_seconds: int | None
    trim_seconds: int | None
    units: tuple[GenerationUnit, ...]
    plan_blockers: tuple[str, ...]
    request_compile_ready: bool
    execution_authorized: bool


def _video_mode(plan: PlanInput) -> str:
    return 'reference_to_video' if plan.referenceNeeds else 'text_to_video'


def _jobs(count: int, commercial: bool) -> tuple[str, ...]:
    if count == 1:
        return (('situación, demostración y siguiente paso' if commercial
                 else 'acción visual completa y estado final'),)
    jobs = []
    for index in range(count):
        if index == 0:
            jobs.append('situación y gancho verificable' if commercial
                        else 'establecimiento y pregunta visual')
        elif index == count - 1:
            jobs.append('oferta y CTA legible' if commercial
                        else 'resolución visual y cierre estable')
        else:
            jobs.append('demostración o nueva información')
    return tuple(jobs)


def _blockers(plan: PlanInput, project_id: str | None) -> list[str]:
    blockers = []
    medium = RECIPES[plan.recipe][2]
    if plan.sourceMode == 'undecided':
        blockers.append('elegir materiales aportados o creatividad de Uony')
    if medium == 'vídeo' and plan.modelChoice is None:
        blockers.append('elegir expresamente el modelo de vídeo')
    if medium == 'vídeo' and plan.durationSeconds is None:
        blockers.append('fijar la duración total')
    if project_id != AUDITED_PROJECT:
        blockers.append('comprobar modelo, región, cuota y pagador en el proyecto')
    if plan.recipe in ('review_card', 'case_study') and not plan.evidence:
        blockers.append('vincular evidencia auténtica; no fabricar prueba')
    if plan.recipe in COMMERCIAL_RECIPES and not plan.cta:
        blockers.append('definir CTA y destino real')
    for index, reference in enumerate(plan.referenceNeeds, 1):
        if reference.required:
            blockers.append(
                f'vincular referencia {index} {reference.role}:{reference.kind}')
    return blockers


def compile_skill_plan(value: PlanInput | dict,
                       project_id: str | None) -> SkillCompilation:
    """Produce un blueprint determinista; no contiene bytes, jobs ni permisos."""
    plan = value if isinstance(value, PlanInput) else PlanInput.model_validate(value)
    label, recommended, medium = RECIPES[plan.recipe]
    del label
    selected = route(plan.recipe, project_id, plan.modelChoice)
    model = selected['model']
    blockers = _blockers(plan, project_id)
    references = tuple(f'{item.role}:{item.kind}' for item in plan.referenceNeeds)
    commercial = plan.recipe in COMMERCIAL_RECIPES

    if medium == 'imagen':
        units = (GenerationUnit(
            'image-01', medium, recommended, 'text_to_image', 0, 0, 0,
            'jerarquía visual y mensaje único', references,
            ('texto exacto en capa controlada', 'revisión a tamaño móvil')),
        )
        generated = trim = None
    elif plan.durationSeconds is None or plan.modelChoice is None:
        units, generated, trim = (), None, None
    else:
        mode = _video_mode(plan)
        try:
            allocation = shot_allocation(model, mode, plan.durationSeconds)
        except ValueError:
            allocation = None
            blockers.append('duración o referencias sin ruta Google comprobada')
        if allocation is None:
            units, generated, trim = (), None, None
        else:
            jobs = _jobs(allocation.shot_count, commercial)
            units_list = []
            for index in range(allocation.shot_count):
                start = index * allocation.clip_seconds
                end = min(start + allocation.clip_seconds,
                          allocation.requested_seconds)
                finishing = ['encuadre contain/cover explícito']
                if index == allocation.shot_count - 1 and allocation.trim_seconds:
                    finishing.append(
                        f'recortar {allocation.trim_seconds}s del final generado')
                if commercial and index == allocation.shot_count - 1:
                    finishing.append('CTA exacta en capa controlada')
                units_list.append(GenerationUnit(
                    f'shot-{index + 1:02d}', medium, model, mode, start, end,
                    allocation.clip_seconds, jobs[index], references,
                    tuple(finishing)))
            units = tuple(units_list)
            generated, trim = allocation.generated_seconds, allocation.trim_seconds

    unique_blockers = tuple(dict.fromkeys(blockers))
    return SkillCompilation(
        SKILL_VERSION, SOURCE_SHA256, plan.recipe, medium, model,
        selected['selectionStatus'], plan.durationSeconds, generated, trim,
        units, unique_blockers, not unique_blockers and bool(units), False)
