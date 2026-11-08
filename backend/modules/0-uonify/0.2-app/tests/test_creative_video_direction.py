"""El director interno produce peticiones exactas, pero nunca las ejecuta."""

from dataclasses import replace

import pytest

from app.creative_planning import AUDITED_PROJECT
from app.creative_skill_compiler import compile_skill_plan
from app.creative_video_direction import (ShotDirection,
                                          compile_directed_video_batch)


def direction(index, **changes):
    value = {
        'unitId': f'shot-{index:02d}',
        'purpose': 'Añadir una nueva información visual útil',
        'framing': 'Plano general a altura de calle con el sujeto visible',
        'action': 'El vehículo se aproxima, cruza el encuadre y deja reflejos en el asfalto',
        'camera': 'follow',
        'endState': 'El vehículo queda al fondo y la calle permanece estable',
        'transition': 'cut',
        'sound': 'Lluvia suave y tránsito lejano',
        'overlayText': [],
    }
    return {**value, **changes}


def cinematic(model='veo-3.1-generate-001', seconds=9):
    return compile_skill_plan({
        'recipe': 'cinematic_video',
        'objective': 'Ciudad futurista bajo la lluvia nocturna',
        'sourceMode': 'uony_concept',
        'modelChoice': model,
        'durationSeconds': seconds,
    }, AUDITED_PROJECT)


def test_veo_directions_compile_into_fingerprinted_shot_requests():
    compiled = cinematic()
    directions = tuple(direction(i) for i in range(1, 4))
    result = compile_directed_video_batch(
        compiled, directions, project=AUDITED_PROJECT)
    assert len(result.batch.requests) == 3
    assert result.batch.generated_seconds == 12 and result.batch.trim_seconds == 3
    assert not result.execution_authorized and not result.batch.approval_ready
    first_prompt = result.batch.requests[0].body['instances'][0]['prompt']
    assert '0–4s — shot-01' in first_prompt
    assert 'End state:' in first_prompt and 'No generated graphic text' in first_prompt
    changed = compile_directed_video_batch(
        compiled, (direction(1, action='Una nave desciende y se detiene sobre la avenida'),
                   *directions[1:]), project=AUDITED_PROJECT)
    assert changed.batch.batch_sha256 != result.batch.batch_sha256


def test_omni_directions_require_unique_durable_destinations():
    compiled = cinematic('gemini-omni-1.1-flash-preview', 9)
    directions = tuple(direction(i) for i in range(1, 4))
    with pytest.raises(ValueError, match='prefijo GCS'):
        compile_directed_video_batch(
            compiled, directions, project=AUDITED_PROJECT)
    prefixes = tuple(
        f'gs://uonify-private-media/creative/attempt-{i}/' for i in range(3))
    result = compile_directed_video_batch(
        compiled, directions, project=AUDITED_PROJECT,
        omni_output_prefixes=prefixes)
    assert all(request.body['background'] is True
               for request in result.batch.requests)
    assert tuple(request.body['response_format'][0]['gcs_uri']
                 for request in result.batch.requests) == prefixes


def test_direction_set_must_match_units_exactly():
    compiled = cinematic()
    with pytest.raises(ValueError, match='exactamente'):
        compile_directed_video_batch(
            compiled, (direction(1), direction(3), direction(2)),
            project=AUDITED_PROJECT)


def test_reference_plan_cannot_bypass_asset_ownership():
    compiled = compile_skill_plan({
        'recipe': 'reference_video',
        'objective': 'Mostrar el objeto con identidad consistente',
        'sourceMode': 'provided',
        'modelChoice': 'gemini-omni-1.1-flash-preview',
        'durationSeconds': 3,
        'referenceNeeds': [{'role': 'product', 'kind': 'image',
                            'description': 'Vista principal del objeto',
                            'required': False}],
    }, AUDITED_PROJECT)
    assert compiled.request_compile_ready
    with pytest.raises(ValueError, match='ownership'):
        compile_directed_video_batch(
            compiled, (direction(1),), project=AUDITED_PROJECT,
            omni_output_prefixes=('gs://private-bucket/attempt/',))


def test_spoken_audio_route_is_explicit_and_external_tts_is_separate():
    compiled = cinematic('gemini-omni-1.1-flash-preview', 3)
    with pytest.raises(ValueError, match='ruta de audio'):
        compile_directed_video_batch(
            compiled, (direction(1, voiceover='Texto exacto'),),
            project=AUDITED_PROJECT,
            omni_output_prefixes=('gs://private-bucket/attempt/',))
    result = compile_directed_video_batch(
        compiled, (direction(1, spokenAudioMode='external_tts',
                             voiceover='Texto exacto'),),
        project=AUDITED_PROJECT,
        omni_output_prefixes=('gs://private-bucket/attempt/',))
    assert len(result.voiceovers) == 1
    prompt = result.batch.requests[0].body['response_format'][0]
    assert prompt['gcs_uri'] == 'gs://private-bucket/attempt/'
    assert result.voiceovers[0].request.script == 'Texto exacto'
    assert result.voiceovers[0].request_sha256 != result.batch.request_hashes[0]
    with pytest.raises(ValueError, match='diálogo sincronizado'):
        ShotDirection.model_validate(direction(
            1, spokenAudioMode='external_tts', dialogue='Hola'))
