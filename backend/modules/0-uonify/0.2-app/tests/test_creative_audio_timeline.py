"""La tarjeta final no puede quedar muda por heredar una duración anterior."""

import pytest

from app.creative_audio_timeline import music_bed, music_ducking, voice_loudness


def test_real_lyria_clip_covers_eight_second_master_with_explicit_fade():
    plan = music_bed(8, 29.361633, 'trim_with_fade',
                     gain_db=-12, fade_seconds=0.5)
    assert len(plan.segments) == 1
    assert plan.segments[0].timeline_end == 8
    assert (plan.fade_out_start_seconds, plan.fade_out_end_seconds) == (7.5, 8)
    assert plan.intentional_silence_start_seconds is None
    assert plan.gain_db == -12 and plan.gain_observed_in_craft
    assert plan.track_keyframe_fade_observed_in_craft
    assert not plan.clip_fade_verified
    assert plan.ducking is None and not plan.normalization_verified


def test_short_music_requires_loop_or_intentional_silence():
    with pytest.raises(ValueError, match='no cubre'):
        music_bed(8, 7, 'trim_with_fade', gain_db=-12)
    loop = music_bed(8, 7, 'loop_with_fade', gain_db=-12)
    assert [(item.timeline_start, item.timeline_end) for item in loop.segments] == [
        (0, 7), (7, 8)]
    silence = music_bed(8, 7, 'intentional_silence', gain_db=-12)
    assert silence.intentional_silence_start_seconds == 7
    assert silence.fade_out_start_seconds is None


def test_implicit_or_invalid_tail_policy_is_rejected():
    with pytest.raises(ValueError, match='explícita'):
        music_bed(8, 29, 'inherit', gain_db=-12)
    with pytest.raises(ValueError, match='Duración'):
        music_bed(8, 29, 'trim_with_fade', gain_db=-12, fade_seconds=0)
    with pytest.raises(ValueError, match='Duración'):
        music_bed(8, 29, 'trim_with_fade', gain_db=13)


def test_optional_ducking_is_bound_to_voice_units_and_observed_settings():
    ducking = music_ducking(('shot-01', 'shot-02'),
                            reduction_db=-15, fade_seconds=0.4)
    plan = music_bed(8, 29.361633, 'trim_with_fade', gain_db=-12,
                     ducking=ducking)
    assert plan.ducking.voice_unit_ids == ('shot-01', 'shot-02')
    assert plan.ducking.operation_observed_in_craft
    with pytest.raises(ValueError, match='ducking'):
        music_ducking((), reduction_db=-15, fade_seconds=0.4)
    with pytest.raises(ValueError, match='ducking'):
        music_ducking(('shot-01',), reduction_db=0, fade_seconds=0.4)


def test_voice_loudness_is_bound_to_units_and_keeps_target_configurable():
    plan = voice_loudness(('shot-01',), measured_lufs=-20.0366,
                          target_lufs=-23)
    assert plan.gain_db == pytest.approx(-2.9634)
    assert plan.operation_observed_in_craft
    other_target = voice_loudness(('shot-01',), measured_lufs=-20,
                                  target_lufs=-16)
    assert other_target.gain_db == 4
    assert not other_target.operation_observed_in_craft
    with pytest.raises(ValueError, match='loudness'):
        voice_loudness((), measured_lufs=-20, target_lufs=-23)
