"""Contrato temporal de música para el montaje final, sin invocar un editor."""

from dataclasses import dataclass
from math import ceil, isfinite


@dataclass(frozen=True)
class AudioSegment:
    timeline_start: float
    timeline_end: float
    source_start: float
    source_end: float


@dataclass(frozen=True)
class DuckingPlan:
    voice_unit_ids: tuple[str, ...]
    reduction_db: float
    fade_seconds: float
    operation_observed_in_craft: bool


@dataclass(frozen=True)
class VoiceLoudnessPlan:
    voice_unit_ids: tuple[str, ...]
    measured_lufs: float
    target_lufs: float
    gain_db: float
    operation_observed_in_craft: bool


@dataclass(frozen=True)
class MusicBedPlan:
    master_duration_seconds: float
    source_duration_seconds: float
    policy: str
    segments: tuple[AudioSegment, ...]
    fade_out_start_seconds: float | None
    fade_out_end_seconds: float | None
    intentional_silence_start_seconds: float | None
    gain_db: float
    gain_observed_in_craft: bool
    ducking: DuckingPlan | None = None
    track_keyframe_fade_observed_in_craft: bool = True
    clip_fade_verified: bool = False
    normalization_verified: bool = False


def voice_loudness(voice_unit_ids: tuple[str, ...], *, measured_lufs: float,
                   target_lufs: float) -> VoiceLoudnessPlan:
    values = (measured_lufs, target_lufs)
    if (not isinstance(voice_unit_ids, tuple) or not voice_unit_ids
            or len(set(voice_unit_ids)) != len(voice_unit_ids)
            or any(not isinstance(value, str) or not value.startswith('shot-')
                   for value in voice_unit_ids)
            or any(isinstance(value, bool) or not isinstance(value, (int, float))
                   or not isfinite(value) for value in values)
            or any(not -70 <= value <= -5 for value in values)):
        raise ValueError('Política de loudness no válida.')
    gain_db = float(target_lufs - measured_lufs)
    observed = (abs(measured_lufs - (-20.0366)) < 1e-4
                and abs(target_lufs - (-23)) < 1e-9
                and abs(gain_db - (-2.9634)) < 1e-4)
    return VoiceLoudnessPlan(voice_unit_ids, float(measured_lufs),
                             float(target_lufs), gain_db, observed)


def music_ducking(voice_unit_ids: tuple[str, ...], *, reduction_db: float,
                  fade_seconds: float) -> DuckingPlan:
    if (not isinstance(voice_unit_ids, tuple) or not voice_unit_ids
            or len(set(voice_unit_ids)) != len(voice_unit_ids)
            or any(not isinstance(value, str) or not value.startswith('shot-')
                   for value in voice_unit_ids)
            or isinstance(reduction_db, bool) or not isinstance(reduction_db, (int, float))
            or isinstance(fade_seconds, bool) or not isinstance(fade_seconds, (int, float))
            or not isfinite(reduction_db) or not isfinite(fade_seconds)
            or not -60 <= reduction_db < 0 or not 0.05 <= fade_seconds <= 5):
        raise ValueError('Política de ducking no válida.')
    observed = (abs(reduction_db - (-15)) < 1e-9
                and abs(fade_seconds - 0.4) < 1e-9)
    return DuckingPlan(voice_unit_ids, float(reduction_db),
                       float(fade_seconds), observed)


def music_bed(master_seconds: float, source_seconds: float, policy: str,
              *, gain_db: float, fade_seconds: float = 0.5,
              ducking: DuckingPlan | None = None) -> MusicBedPlan:
    """Cubre el master o registra expresamente el silencio; nunca lo hereda."""
    values = (master_seconds, source_seconds, fade_seconds, gain_db)
    if (any(isinstance(value, bool) or not isinstance(value, (int, float))
            or not isfinite(value) for value in values)
            or not 0 < master_seconds <= 600 or not 0 < source_seconds <= 3600
            or not 0 < fade_seconds <= min(5, master_seconds)
            or not -60 <= gain_db <= 12):
        raise ValueError('Duración o fade de música no válido.')
    if policy not in ('trim_with_fade', 'loop_with_fade', 'intentional_silence'):
        raise ValueError('La cola musical debe ser explícita.')
    if ducking is not None and not isinstance(ducking, DuckingPlan):
        raise ValueError('Política de ducking no válida.')
    if policy == 'trim_with_fade':
        if source_seconds < master_seconds:
            raise ValueError('La música no cubre el master; elige loop o silencio.')
        segments = (AudioSegment(0, master_seconds, 0, master_seconds),)
        silence = None
    elif policy == 'loop_with_fade':
        count, segments_list = ceil(master_seconds / source_seconds), []
        for index in range(count):
            start = index * source_seconds
            end = min(master_seconds, start + source_seconds)
            segments_list.append(AudioSegment(start, end, 0, end - start))
        segments, silence = tuple(segments_list), None
    else:
        end = min(master_seconds, source_seconds)
        segments = (AudioSegment(0, end, 0, end),)
        silence = end if end < master_seconds else None
    fade_end = None if silence is not None else master_seconds
    fade_start = None if fade_end is None else max(0, fade_end - fade_seconds)
    return MusicBedPlan(master_seconds, source_seconds, policy, segments,
                        fade_start, fade_end, silence, float(gain_db),
                        abs(gain_db - (-12)) < 1e-9, ducking)
