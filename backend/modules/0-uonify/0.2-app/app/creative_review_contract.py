"""Contrato de revisión humana posterior a la evaluación técnica del vídeo."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .creative_media_evaluation import BatchEvaluation
from .creative_image_direction import ImageEvaluation
from .creative_composite_quote import canonical_sha256
from .onboarding import StrictBody


ReviewGate = Literal['factual', 'commercial', 'realism_design',
                     'video_sound', 'technical']
ReviewVerdictValue = Literal['pass', 'revise', 'unverified']


class InspectionCoverage(StrictBody):
    artifactRef: str = Field(min_length=3, max_length=500)
    fullVideoPlayed: bool
    audioReviewed: bool
    fullResolutionInspected: bool
    intendedDisplaySizeInspected: bool
    tracksVerified: bool
    sampledFramesSeconds: list[float] = Field(default_factory=list, max_length=120)

    @model_validator(mode='after')
    def valid(self):
        if any(value < 0 or value > 3600 for value in self.sampledFramesSeconds):
            raise ValueError('Muestra temporal de revisión no válida.')
        if self.sampledFramesSeconds != sorted(set(self.sampledFramesSeconds)):
            raise ValueError('Las muestras deben ser únicas y estar ordenadas.')
        return self


class ImageInspectionCoverage(StrictBody):
    artifactRef: str = Field(min_length=3, max_length=500)
    fullResolutionInspected: bool
    intendedDisplaySizeInspected: bool
    cropAndOverlayPreviewInspected: bool
    exactCopyInspected: bool


class ReviewVerdict(StrictBody):
    gate: ReviewGate
    verdict: ReviewVerdictValue
    severity: Literal['none', 'low', 'medium', 'high']
    artifactRef: str = Field(min_length=3, max_length=500)
    sourceRef: str | None = Field(default=None, max_length=500)
    observedAt: datetime
    consequence: str = Field(min_length=8, max_length=500)
    owner: str = Field(min_length=2, max_length=120)
    smallestFix: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def coherent(self):
        if self.verdict == 'pass' and self.severity != 'none':
            raise ValueError('Un gate aprobado no puede conservar severidad.')
        if self.verdict != 'pass' and not self.smallestFix:
            raise ValueError('Un gate abierto necesita la corrección mínima.')
        if self.verdict == 'revise' and self.severity == 'none':
            raise ValueError('Una revisión necesaria debe indicar severidad.')
        return self


@dataclass(frozen=True)
class ReviewDecision:
    batch_sha256: str
    release_state: str
    blockers: tuple[str, ...]
    repair_required: bool
    reviewed_for_test: bool
    proven_to_convert: bool = False


_GATES: tuple[ReviewGate, ...] = (
    'factual', 'commercial', 'realism_design', 'video_sound', 'technical')


def decide_video_review(
        evaluation: BatchEvaluation,
        coverage: InspectionCoverage | dict,
        verdicts: tuple[ReviewVerdict | dict, ...],
        ) -> ReviewDecision:
    """Decide estado de prueba; no aprueba publicación ni rendimiento comercial."""
    if not isinstance(evaluation, BatchEvaluation):
        raise ValueError('Evaluación técnica no válida.')
    inspected = (coverage if isinstance(coverage, InspectionCoverage)
                 else InspectionCoverage.model_validate(coverage))
    if not isinstance(verdicts, tuple):
        raise ValueError('Los veredictos deben estar cerrados.')
    parsed = tuple(item if isinstance(item, ReviewVerdict)
                   else ReviewVerdict.model_validate(item) for item in verdicts)
    gates = tuple(item.gate for item in parsed)
    if gates != _GATES:
        raise ValueError('La revisión debe contener todos los gates en orden.')
    if any(item.artifactRef != inspected.artifactRef for item in parsed):
        raise ValueError('Los veredictos no corresponden al artefacto inspeccionado.')

    blockers = []
    if not evaluation.ready_for_human_review:
        blockers.append('resolver fallos técnicos automáticos por toma')
    if not inspected.fullVideoPlayed:
        blockers.append('reproducir el vídeo completo a velocidad normal')
    if not inspected.audioReviewed:
        blockers.append('revisar el audio completo')
    if not inspected.fullResolutionInspected:
        blockers.append('inspeccionar el artefacto a resolución completa')
    if not inspected.intendedDisplaySizeInspected:
        blockers.append('inspeccionar el tamaño de publicación previsto')
    if not inspected.tracksVerified:
        blockers.append('verificar las pistas requeridas')
    if not inspected.sampledFramesSeconds:
        blockers.append('registrar fotogramas de contacto, transición y texto')
    for item in parsed:
        if item.verdict != 'pass':
            blockers.append(f'{item.gate}: {item.verdict} — {item.smallestFix}')
    unique = tuple(dict.fromkeys(blockers))
    repair = any(item.verdict == 'revise' for item in parsed)
    passed = not unique
    return ReviewDecision(
        evaluation.batch_sha256,
        'reviewed_for_test' if passed else 'partial/blocked',
        unique, repair, passed)


def decide_image_review(
        evaluation: ImageEvaluation,
        coverage: ImageInspectionCoverage | dict,
        verdicts: tuple[ReviewVerdict | dict, ...],
        ) -> ReviewDecision:
    """Decide revisión de un estático; no autoriza campaña ni publicación."""
    if not isinstance(evaluation, ImageEvaluation):
        raise ValueError('Evaluación de imagen no válida.')
    inspected = (coverage if isinstance(coverage, ImageInspectionCoverage)
                 else ImageInspectionCoverage.model_validate(coverage))
    if not isinstance(verdicts, tuple):
        raise ValueError('Los veredictos deben estar cerrados.')
    parsed = tuple(item if isinstance(item, ReviewVerdict)
                   else ReviewVerdict.model_validate(item) for item in verdicts)
    image_gates = ('factual', 'commercial', 'realism_design', 'technical')
    if tuple(item.gate for item in parsed) != image_gates:
        raise ValueError('La revisión de imagen debe contener todos los gates en orden.')
    if any(item.artifactRef != inspected.artifactRef for item in parsed):
        raise ValueError('Los veredictos no corresponden al artefacto inspeccionado.')
    blockers = []
    if not evaluation.automatic_passed:
        blockers.append('resolver fallos técnicos automáticos de la imagen')
    checks = (
        (inspected.fullResolutionInspected,
         'inspeccionar el artefacto a resolución completa'),
        (inspected.intendedDisplaySizeInspected,
         'inspeccionar el tamaño de publicación previsto'),
        (inspected.cropAndOverlayPreviewInspected,
         'inspeccionar el recorte y overlays de la publicación'),
        (inspected.exactCopyInspected,
         'verificar el copy exacto después del finishing'),
    )
    blockers.extend(message for passed, message in checks if not passed)
    for item in parsed:
        if item.verdict != 'pass':
            blockers.append(f'{item.gate}: {item.verdict} — {item.smallestFix}')
    unique = tuple(dict.fromkeys(blockers))
    repair = any(item.verdict == 'revise' for item in parsed)
    passed = not unique
    return ReviewDecision(
        evaluation.request_sha256,
        'reviewed_for_test' if passed else 'partial/blocked',
        unique, repair, passed)


def decide_candidate_review(
        artifact_refs: tuple[dict, ...], kinds: tuple[str, ...],
        durations: tuple[float | None, ...],
        coverage: dict, verdicts: tuple[dict, ...], reviewer: str,
        ) -> ReviewDecision:
    """Valida evidencia durable multi-asset antes de liberar una cuarentena."""
    if (not artifact_refs or len(artifact_refs) != len(kinds)
            or len(durations) != len(kinds)
            or any(kind not in ('image', 'video', 'audio', 'image_sequence')
                   for kind in kinds)
            or not isinstance(reviewer, str) or not reviewer):
        raise ValueError('Los artefactos de revisión no son válidos.')
    references = list(artifact_refs)
    common = {'artifactRefs', 'fullResolutionInspected',
              'intendedDisplaySizeInspected'}
    required = set(common)
    if 'image' in kinds:
        required.update({'cropAndOverlayPreviewInspected', 'exactCopyInspected'})
    if any(kind in ('video', 'audio') for kind in kinds):
        required.update({'fullVideoPlayed', 'audioReviewed', 'tracksVerified',
                         'sampledFramesSeconds'})
    if 'image_sequence' in kinds:
        required.update({'sequencePlaybackInspected', 'frameOrderVerified',
                         'alphaVerified', 'sampledFramesSeconds'})
    if (not isinstance(coverage, dict) or set(coverage) != required
            or coverage.get('artifactRefs') != references):
        raise ValueError('La cobertura durable no coincide con los artefactos.')
    blockers = []
    for field in required - {'artifactRefs', 'sampledFramesSeconds'}:
        if coverage.get(field) is not True:
            blockers.append(f'coverage:{field}')
    if 'sampledFramesSeconds' in required:
        sampled = coverage.get('sampledFramesSeconds')
        sequence_durations = [duration for duration, kind in zip(durations, kinds)
                              if kind == 'image_sequence']
        if (not isinstance(sampled, list) or not sampled
                or sampled != sorted(set(sampled))
                or any(not isinstance(item, (int, float))
                       or isinstance(item, bool) or not 0 <= item <= 3600
                       for item in sampled)
                or any(not isinstance(duration, (int, float))
                       or isinstance(duration, bool) or duration <= 0
                       for duration in sequence_durations)
                or sequence_durations and max(sampled) > min(sequence_durations)):
            blockers.append('coverage:sampledFramesSeconds')
    gates = ['factual', 'commercial', 'realism_design']
    if any(kind in ('video', 'audio') for kind in kinds):
        gates.append('video_sound')
    if 'image_sequence' in kinds:
        gates.append('motion')
    gates.append('technical')
    if not isinstance(verdicts, tuple) or len(verdicts) != len(gates):
        raise ValueError('La revisión no contiene todos los gates canónicos.')
    for gate, item in zip(gates, verdicts):
        fields = {'gate', 'verdict', 'severity', 'artifactRefs', 'observedAt',
                  'consequence', 'owner', 'smallestFix'}
        if (not isinstance(item, dict) or set(item) != fields
                or item.get('gate') != gate
                or item.get('verdict') not in ('pass', 'revise', 'unverified')
                or item.get('severity') not in ('none', 'low', 'medium', 'high')
                or item.get('artifactRefs') != references
                or item.get('owner') != reviewer
                or not isinstance(item.get('observedAt'), str)
                or not isinstance(item.get('consequence'), str)
                or len(item['consequence']) < 8):
            raise ValueError('Un veredicto durable no coincide con su gate.')
        try:
            observed = datetime.fromisoformat(item['observedAt'].replace('Z', '+00:00'))
        except ValueError:
            raise ValueError('Un veredicto no tiene fecha verificable.') from None
        if observed.tzinfo is None:
            raise ValueError('Un veredicto no tiene fecha verificable.')
        if item['verdict'] == 'pass':
            if item['severity'] != 'none' or item['smallestFix'] is not None:
                raise ValueError('Un gate aprobado conserva una incidencia.')
        else:
            if (item['severity'] == 'none'
                    or not isinstance(item['smallestFix'], str)
                    or not item['smallestFix']):
                raise ValueError('Un gate abierto no indica su corrección.')
            blockers.append(f'{gate}:{item["verdict"]}')
    unique = tuple(dict.fromkeys(blockers))
    return ReviewDecision(
        canonical_sha256(references),
        'reviewed_for_test' if not unique else 'partial/blocked',
        unique, any('revise' in item for item in unique), not unique)
