"""La validación automática prepara revisión; nunca acepta creatividad por sí sola."""

from dataclasses import replace
from hashlib import sha256
from pathlib import Path

import pytest

from app.creative_media_evaluation import (BoundShotOutput,
                                            evaluate_video_batch)
from app.creative_planning import AUDITED_PROJECT
from app.creative_skill_compiler import compile_skill_plan
from app.creative_video_contracts import (VideoOutput, mp4_duration_seconds,
                                          mp4_video_geometry)
from app.creative_video_direction import (ShotDirection,
                                          compile_directed_video_batch)


AUDIT = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results')


def output(name):
    data = (AUDIT / name).read_bytes()
    width, height, frame_rate = mp4_video_geometry(data)
    return VideoOutput('video/mp4', data, sha256(data).hexdigest(),
                       mp4_duration_seconds(data), width, height, frame_rate)


def directed(model, seconds, *, voice=False):
    compiled = compile_skill_plan({
        'recipe': 'cinematic_video',
        'objective': 'Crear una ciudad futurista coherente bajo la lluvia',
        'sourceMode': 'uony_concept',
        'modelChoice': model,
        'durationSeconds': seconds,
    }, AUDITED_PROJECT)
    direction = ShotDirection(
        unitId='shot-01', purpose='Presentar una ciudad futurista reconocible',
        framing='Plano general horizontal con horizonte estable',
        action='Un vehículo cruza la avenida y deja reflejos sobre el asfalto',
        camera='follow', endState='El vehículo sale y la avenida queda visible',
        transition='cut',
        spokenAudioMode='external_tts' if voice else 'none',
        voiceover='La ciudad despierta bajo la lluvia.' if voice else None,
        overlayText=['Uonify'] if voice else [])
    kwargs = ({'omni_output_prefixes':
               ('gs://uonify-private-media/creative/eval-shot-01/',)}
              if model.startswith('gemini-omni') else {})
    return compile_directed_video_batch(
        compiled, (direction,), project=AUDITED_PROJECT, **kwargs)


def test_real_omni_clip_passes_technical_checks_but_requires_human_review():
    batch = directed('gemini-omni-1.1-flash-preview', 3, voice=True)
    clip = output('gemini-omni-1.1-flash-preview-1.mp4')
    result = evaluate_video_batch(batch, (BoundShotOutput(
        'shot-01', batch.batch.request_hashes[0], clip, 'cover'),))
    shot = result.shots[0]
    assert result.ready_for_human_review and shot.automatic_passed
    assert shot.framing.uniform_scale_percent == 200
    assert shot.human_review_required and not shot.accepted_for_use
    assert any('palabra por palabra' in check for check in shot.human_checks)
    assert len(batch.voiceovers) == 1
    assert batch.voiceovers[0].request.script == 'La ciudad despierta bajo la lluvia.'
    prompt = batch.batch.requests[0].body['input'][0]['text']
    assert 'external voiceover is reserved' in prompt
    assert 'La ciudad despierta' not in prompt
    assert not result.accepted_for_use


def test_real_veo_clip_passes_with_its_exact_request_binding():
    batch = directed('veo-3.1-generate-001', 4)
    clip = output('veo-3.1-generate-001-poll-1792279454-1.mp4')
    result = evaluate_video_batch(batch, (BoundShotOutput(
        'shot-01', batch.batch.request_hashes[0], clip, 'contain'),))
    assert result.ready_for_human_review
    assert result.shots[0].framing.uniform_scale_percent == 100


def test_tampered_metadata_is_reported_and_never_ready_for_review():
    batch = directed('gemini-omni-1.1-flash-preview', 3)
    clip = replace(output('gemini-omni-1.1-flash-preview-1.mp4'),
                   sha256='0' * 64, duration_seconds=9)
    result = evaluate_video_batch(batch, (BoundShotOutput(
        'shot-01', batch.batch.request_hashes[0], clip, 'cover'),))
    assert not result.ready_for_human_review
    assert result.shots[0].automatic_issues == (
        'SHA-256 declarado no coincide con los bytes',
        'duración declarada no coincide con los bytes')


def test_wrong_request_binding_or_unit_is_rejected_before_evaluation():
    batch = directed('veo-3.1-generate-001', 4)
    clip = output('veo-3.1-generate-001-poll-1792279454-1.mp4')
    with pytest.raises(ValueError, match='huella'):
        evaluate_video_batch(batch, (BoundShotOutput(
            'shot-01', 'f' * 64, clip, 'cover'),))
    with pytest.raises(ValueError, match='unidades'):
        evaluate_video_batch(batch, (BoundShotOutput(
            'shot-02', batch.batch.request_hashes[0], clip, 'cover'),))
