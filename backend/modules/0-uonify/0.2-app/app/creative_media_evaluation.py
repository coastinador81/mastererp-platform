"""Evalúa conformidad técnica por toma; la aceptación creativa sigue siendo humana.

No ejecuta proveedores, no modifica archivos y no convierte una salida válida en
un asset aprobado. La asociación con la petición se exige mediante su huella.
"""

from dataclasses import dataclass
from hashlib import sha256
from typing import Literal

from .creative_google_capabilities import ModelId

from .creative_video_contracts import (VideoOutput, mp4_duration_seconds,
                                       mp4_video_geometry)
from .creative_video_direction import DirectedVideoBatch, ShotDirection
from .creative_video_framing import VideoFraming, frame_for_canvas


@dataclass(frozen=True)
class BoundShotOutput:
    unit_id: str
    request_sha256: str
    output: VideoOutput
    framing_mode: Literal['contain', 'cover']


@dataclass(frozen=True)
class ShotEvaluation:
    unit_id: str
    request_sha256: str
    automatic_passed: bool
    automatic_issues: tuple[str, ...]
    human_checks: tuple[str, ...]
    framing: VideoFraming | None
    human_review_required: bool = True
    accepted_for_use: bool = False


@dataclass(frozen=True)
class BatchEvaluation:
    batch_sha256: str
    shots: tuple[ShotEvaluation, ...]
    ready_for_human_review: bool
    accepted_for_use: bool = False


def _expected_seconds(request) -> int:
    if request.model == ModelId.OMNI_11:
        value = request.body['response_format'][0]['duration']
        return int(value.removesuffix('s'))
    return int(request.body['parameters']['durationSeconds'])


def _human_checks(direction: ShotDirection) -> tuple[str, ...]:
    checks = [
        f'El plano cumple el propósito: {direction.purpose.strip()}',
        f'La composición respeta el encuadre: {direction.framing.strip()}',
        f'La acción, contacto y consecuencia son correctos: {direction.action.strip()}',
        f'El movimiento de cámara corresponde a {direction.camera.replace("_", " ")}.',
        f'El estado final permite el corte previsto: {direction.endState.strip()}',
        'No aparecen marcas, testimonios, pruebas ni interfaces inventadas.',
        'No hay artefactos visuales, anatomía u objetos deformados ni saltos de identidad.',
    ]
    if direction.voiceover:
        checks.append('La voz en off coincide palabra por palabra y mantiene el tono previsto.')
    if direction.dialogue:
        checks.append('El diálogo coincide palabra por palabra y su sincronía labial es aceptable.')
    if direction.sound:
        checks.append('El sonido corresponde a la acción y no tapa voz o diálogo.')
    if direction.overlayText:
        checks.append('Existe espacio seguro para los rótulos exactos del montaje; el vídeo no los inventa.')
    return tuple(checks)


def _technical_issues(output: VideoOutput, expected_seconds: int) -> tuple[str, ...]:
    issues = []
    if not isinstance(output, VideoOutput) or output.mime_type != 'video/mp4':
        return ('salida de vídeo o MIME no válidos',)
    try:
        digest = sha256(output.data).hexdigest()
        duration = mp4_duration_seconds(output.data)
        width, height, frame_rate = mp4_video_geometry(output.data)
    except (TypeError, ValueError):
        return ('bytes MP4 no verificables',)
    if digest != output.sha256:
        issues.append('SHA-256 declarado no coincide con los bytes')
    if abs(duration - output.duration_seconds) > 0.001:
        issues.append('duración declarada no coincide con los bytes')
    if (width, height, round(frame_rate, 6)) != (
            output.width_pixels, output.height_pixels,
            round(output.frame_rate, 6)):
        issues.append('geometría o cadencia declarada no coincide con los bytes')
    if abs(duration - expected_seconds) > 0.25:
        issues.append('duración fuera de la tolerancia de la solicitud')
    if abs(width / height - 16 / 9) > 0.01:
        issues.append('relación de aspecto distinta de 16:9')
    if not 1 <= frame_rate <= 120:
        issues.append('cadencia fuera del rango técnico admitido')
    return tuple(issues)


def evaluate_video_batch(
        directed: DirectedVideoBatch,
        outputs: tuple[BoundShotOutput, ...], *,
        target_width: int = 1280,
        target_height: int = 720,
        ) -> BatchEvaluation:
    """Compara cada clip con petición/dirección y prepara la revisión humana."""
    if not isinstance(directed, DirectedVideoBatch):
        raise ValueError('Lote dirigido no válido.')
    if not isinstance(outputs, tuple) or len(outputs) != len(directed.batch.requests):
        raise ValueError('Las salidas no corresponden exactamente al lote.')
    expected_units = tuple(item.unitId for item in directed.directions)
    received_units = tuple(item.unit_id for item in outputs
                           if isinstance(item, BoundShotOutput))
    if received_units != expected_units or len(received_units) != len(outputs):
        raise ValueError('Las salidas no corresponden exactamente a las unidades.')
    expected_hashes = directed.batch.request_hashes
    received_hashes = tuple(item.request_sha256 for item in outputs)
    if received_hashes != expected_hashes:
        raise ValueError('Las salidas no conservan la huella y el orden del lote.')

    evaluations = []
    for request, direction, bound in zip(
            directed.batch.requests, directed.directions, outputs):
        issues = _technical_issues(bound.output, _expected_seconds(request))
        framing = None
        if not issues:
            try:
                framing = frame_for_canvas(
                    bound.output, target_width, target_height, bound.framing_mode)
            except ValueError as exc:
                issues = (str(exc),)
        evaluations.append(ShotEvaluation(
            bound.unit_id, bound.request_sha256, not issues, issues,
            _human_checks(direction), framing))
    shots = tuple(evaluations)
    return BatchEvaluation(directed.batch.batch_sha256, shots,
                           all(item.automatic_passed for item in shots))
