"""Dirección tipada de planos y compilación a un lote Google, sin ejecución."""

from dataclasses import dataclass
from typing import Literal

from pydantic import Field, model_validator

from .creative_google_capabilities import omni_model_ids
from .creative_planning import AUDITED_PROJECT
from .creative_skill_compiler import SkillCompilation
from .creative_strategy_contract import (StrategyBinding, StrategyContext,
                                          bind_strategy)
from .creative_video_batch import VideoBatch, VideoShot, prepare_video_batch
from .creative_voiceover_contracts import VoiceoverRequest, voiceover_request
from .creative_request_fingerprint import fingerprint
from .onboarding import StrictBody


class ShotDirection(StrictBody):
    unitId: str = Field(pattern=r'^shot-[0-9]{2}$')
    purpose: str = Field(min_length=8, max_length=240)
    framing: str = Field(min_length=8, max_length=320)
    action: str = Field(min_length=8, max_length=640)
    camera: Literal['hold', 'follow', 'reveal', 'motivated_move']
    endState: str = Field(min_length=8, max_length=420)
    transition: Literal['continuous', 'cut', 'assembly_boundary']
    spokenAudioMode: Literal['none', 'model_native', 'external_tts'] = 'none'
    voiceover: str | None = Field(default=None, max_length=400)
    dialogue: str | None = Field(default=None, max_length=300)
    sound: str | None = Field(default=None, max_length=240)
    overlayText: list[str] = Field(default_factory=list, max_length=4)

    @model_validator(mode='after')
    def valid_audio(self):
        spoken = bool(self.voiceover or self.dialogue)
        if self.spokenAudioMode == 'none' and spoken:
            raise ValueError('La voz o diálogo necesita una ruta de audio explícita.')
        if self.spokenAudioMode != 'none' and not spoken:
            raise ValueError('La ruta de audio hablado necesita texto.')
        if self.dialogue and self.spokenAudioMode != 'model_native':
            raise ValueError('El diálogo sincronizado requiere audio nativo del modelo.')
        return self


@dataclass(frozen=True)
class VoiceoverPlan:
    unit_id: str
    request: VoiceoverRequest
    request_sha256: str


@dataclass(frozen=True)
class DirectedVideoBatch:
    skill_version: str
    skill_source_sha256: str
    directions: tuple[ShotDirection, ...]
    batch: VideoBatch
    voiceovers: tuple[VoiceoverPlan, ...] = ()
    strategy_sha256: str | None = None
    execution_authorized: bool = False


def _prompt(unit, direction: ShotDirection) -> str:
    audio = []
    if direction.voiceover and direction.spokenAudioMode == 'model_native':
        audio.append('[Voiceover] ' + direction.voiceover.strip())
    if direction.dialogue:
        audio.append('[Dialogue] ' + direction.dialogue.strip())
    if direction.sound:
        audio.append('[Sound] ' + direction.sound.strip())
    if direction.spokenAudioMode == 'external_tts':
        audio.insert(0, 'No spoken words; external voiceover is reserved for finishing.')
    audio_text = ' | '.join(audio) if audio else 'No spoken words or added music.'
    overlays = ('Exact graphic text reserved for controlled finishing: '
                + ' | '.join(value.strip() for value in direction.overlayText)
                if direction.overlayText else
                'No generated graphic text; preserve clear finishing space.')
    camera = direction.camera.replace('_', ' ')
    return (f'{unit.start_seconds}–{unit.end_seconds}s — {unit.unit_id}. '
            f'Purpose: {direction.purpose.strip()}. '
            f'Framing: {direction.framing.strip()}. '
            f'Action: {direction.action.strip()}. '
            f'Camera: {camera}. '
            f'End state: {direction.endState.strip()}. '
            f'Transition: {direction.transition.replace("_", " ")}. '
            f'{audio_text} {overlays} '
            'Preserve physical cause, contact and consequence. '
            'Do not invent brands, proof, testimonials or interface states.')


def compile_directed_video_batch(
        compilation: SkillCompilation,
        directions: tuple[ShotDirection | dict, ...], *,
        project: str,
        omni_output_prefixes: tuple[str, ...] | None = None,
        strategy: StrategyBinding | None = None,
        strategy_context: StrategyContext | dict | None = None,
        ) -> DirectedVideoBatch:
    """Compila planos desde cero; referencias esperan al registro de assets."""
    if not isinstance(compilation, SkillCompilation):
        raise ValueError('Compilación creativa no válida.')
    if not compilation.request_compile_ready or compilation.medium != 'vídeo':
        raise ValueError('El plan todavía no permite compilar peticiones de vídeo.')
    if project != AUDITED_PROJECT:
        raise ValueError('El proyecto Google no coincide con la capacidad auditada.')
    if any(unit.reference_requirements for unit in compilation.units):
        raise ValueError('Las referencias requieren ownership y binding de assets.')
    if (strategy is None) != (strategy_context is None):
        raise ValueError('La estrategia y su contexto deben validarse juntos.')
    strategy_sha256 = None
    if strategy is not None:
        rebound = bind_strategy(compilation, strategy_context)
        if (not isinstance(strategy, StrategyBinding) or not strategy.strategy_ready
                or strategy.strategy_sha256 != rebound.strategy_sha256
                or strategy.skill_version != compilation.source_skill_version
                or strategy.skill_source_sha256 != compilation.source_sha256):
            raise ValueError('La estrategia no está lista o cambió desde su validación.')
        strategy_sha256 = strategy.strategy_sha256
    if not isinstance(directions, tuple):
        raise ValueError('Las direcciones de plano deben estar cerradas.')
    parsed = tuple(item if isinstance(item, ShotDirection)
                   else ShotDirection.model_validate(item) for item in directions)
    expected = tuple(unit.unit_id for unit in compilation.units)
    received = tuple(item.unitId for item in parsed)
    if received != expected or len(set(received)) != len(received):
        raise ValueError('Las direcciones no corresponden exactamente a las unidades.')
    if compilation.model in omni_model_ids() and omni_output_prefixes is None:
        raise ValueError('Omni durable requiere un prefijo GCS único por plano.')
    shots = tuple(VideoShot(_prompt(unit, direction))
                  for unit, direction in zip(compilation.units, parsed))
    batch = prepare_video_batch(
        project, compilation.model, compilation.requested_seconds, shots,
        omni_output_prefixes=omni_output_prefixes)
    if (batch.generated_seconds != compilation.generated_seconds
            or batch.trim_seconds != compilation.trim_seconds):
        raise ValueError('El lote no conserva la duración del plan compilado.')
    voiceovers = tuple(
        VoiceoverPlan(direction.unitId, request,
                      fingerprint(request).sha256)
        for direction in parsed if direction.spokenAudioMode == 'external_tts'
        for request in (voiceover_request(project, direction.voiceover),))
    return DirectedVideoBatch(
        compilation.source_skill_version, compilation.source_sha256,
        parsed, batch, voiceovers, strategy_sha256)
