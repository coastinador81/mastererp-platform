"""Las peticiones se validan localmente; estas pruebas jamás llaman a Google."""

from base64 import b64decode, b64encode

import pytest

from app.creative_video_contracts import (VideoMedia, mp4_duration_seconds,
                                          omni_background_request, omni_completed,
                                          omni_completed_uris,
                                          omni_interaction_id, omni_request,
                                          omni_recovery_request, veo_completed,
                                          veo_operation_name, veo_recovery_request,
                                          veo_request)


PROJECT = 'uonify-757ec8c3ab3245ffa45d'
IMAGE = VideoMedia('image', 'image/png', b'\x89PNG\r\n\x1a\nsynthetic')


def mp4(seconds):
    def box(kind, payload):
        return (len(payload) + 8).to_bytes(4, 'big') + kind + payload
    ftyp = b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00isommp42'
    mvhd = box(b'mvhd', b'\x00' * 12 + (1000).to_bytes(4, 'big') +
               (seconds * 1000).to_bytes(4, 'big'))
    tkhd = box(b'tkhd', b'\x00\x00\x00\x07' + b'\x00' * 8 +
               (1).to_bytes(4, 'big') + b'\x00' * 4 +
               (seconds * 24000).to_bytes(4, 'big') + b'\x00' * 16 +
               b'\x00' * 36 + (640 << 16).to_bytes(4, 'big') +
               (360 << 16).to_bytes(4, 'big'))
    mdhd = box(b'mdhd', b'\x00' * 12 + (24000).to_bytes(4, 'big') +
               (seconds * 24000).to_bytes(4, 'big') + b'\x00' * 4)
    hdlr = box(b'hdlr', b'\x00' * 8 + b'vide')
    stts = box(b'stts', b'\x00' * 4 + (1).to_bytes(4, 'big') +
               (seconds * 24).to_bytes(4, 'big') + (1000).to_bytes(4, 'big'))
    trak = box(b'trak', tkhd + box(b'mdia', mdhd + hdlr +
                                  box(b'minf', box(b'stbl', stts))))
    return ftyp + box(b'moov', mvhd + trak)


VIDEO = VideoMedia('video', 'video/mp4', mp4(3))


def test_veo_fast_subject_image_matches_verified_request_shape():
    request = veo_request(PROJECT, 'veo-3.1-fast-generate-001', ' Cubo azul ', IMAGE)
    assert request.endpoint.endswith('veo-3.1-fast-generate-001:predictLongRunning')
    assert request.mode == 'reference_to_video'
    assert request.body['instances'][0]['prompt'] == 'Cubo azul'
    image = request.body['instances'][0]['referenceImages'][0]
    assert image['referenceType'] == 'asset'
    assert b64decode(image['image']['bytesBase64Encoded']) == IMAGE.data
    assert request.body['parameters']['durationSeconds'] == 8
    assert request.input_manifest[0]['bytes'] == len(IMAGE.data)
    assert 'synthetic' not in str(request.input_manifest)


def test_veo_standard_only_builds_observed_text_mode():
    request = veo_request(PROJECT, 'veo-3.1-generate-001', 'Ciudad nocturna')
    assert request.mode == 'text_to_video'
    assert 'referenceImages' not in request.body['instances'][0]
    assert request.body['parameters']['durationSeconds'] == 4
    with pytest.raises(ValueError, match='Solo se probó'):
        veo_request(PROJECT, 'veo-3.1-generate-001', 'Ciudad nocturna', IMAGE)
    with pytest.raises(ValueError, match='Modelo Veo'):
        veo_request(PROJECT, 'veo-4-unknown', 'Ciudad nocturna')


def test_omni_image_and_video_references_match_verified_request_shape():
    request = omni_request(PROJECT, 'Cubo en rotación', (IMAGE, VIDEO))
    assert request.endpoint.endswith('/locations/global/interactions')
    assert request.body['model'] == 'gemini-omni-1.1-flash-preview'
    assert [item['type'] for item in request.body['input']] == ['text', 'image', 'video']
    assert b64decode(request.body['input'][2]['data']) == VIDEO.data
    assert request.body['response_format'][0]['duration'] == '3s'
    assert request.body['generation_config']['video_config']['task'] == 'reference_to_video'
    assert request.input_manifest[1]['durationSeconds'] == 3


def test_omni_text_only_uses_the_observed_text_mode():
    request = omni_request(PROJECT, 'Ciudad bajo la lluvia', ())
    assert request.mode == 'text_to_video'
    assert request.input_manifest == ()
    assert request.body['input'] == [{'type': 'text', 'text': 'Ciudad bajo la lluvia'}]
    assert request.body['response_format'] == [{
        'type': 'video', 'resolution': '360p', 'duration': '3s', 'aspect_ratio': '16:9'}]


def test_omni_background_uses_durable_interaction_and_uri_delivery():
    request = omni_background_request(
        PROJECT, 'Ciudad bajo la lluvia',
        'gs://uonify-private-media/creative/attempt-123/',
        duration_seconds=10, resolution='720p', aspect_ratio='9:16')
    assert request.mode == 'text_to_video_background'
    assert request.input_manifest == ()
    assert request.body['background'] is True
    assert request.body['store'] is True
    assert request.body['stream'] is False
    assert request.body['response_format'] == [{
        'type': 'video', 'delivery': 'uri',
        'gcs_uri': 'gs://uonify-private-media/creative/attempt-123/',
        'aspect_ratio': '9:16', 'resolution': '720p', 'duration': '10s'}]
    assert omni_interaction_id({
        'id': 'interaction_123', 'status': 'in_progress',
        'object': 'interaction'}) == 'interaction_123'


@pytest.mark.parametrize('uri', [
    'https://storage.googleapis.com/bucket/path/',
    'gs://bucket/path',
    'gs://bucket/../path/',
    'gs://bucket/path/?generation=1',
])
def test_omni_background_rejects_unsafe_output_prefix(uri):
    with pytest.raises(ValueError, match='Prefijo GCS'):
        omni_background_request(PROJECT, 'Ciudad', uri)


def test_omni_background_rejects_unbounded_parameters_and_bad_receipt():
    with pytest.raises(ValueError, match='duraciones'):
        omni_background_request(PROJECT, 'Ciudad', 'gs://bucket/path/',
                                duration_seconds=11)
    with pytest.raises(ValueError, match='interacción recuperable'):
        omni_interaction_id({'id': 'interaction_123', 'status': 'completed',
                             'object': 'interaction'})


def test_omni_edit_omits_generation_only_options():
    request = omni_request(PROJECT, 'Aclara el fondo', (VIDEO,), edit=True)
    assert request.mode == 'edit'
    assert request.body['response_format'] == [
        {'type': 'video', 'delivery': 'inline', 'resolution': '360p'}]
    assert request.body['generation_config']['video_config']['task'] == 'edit'
    with pytest.raises(ValueError, match='exactamente un vídeo'):
        omni_request(PROJECT, 'Aclara el fondo', (IMAGE, VIDEO), edit=True)


@pytest.mark.parametrize('bad', [
    VideoMedia('video', 'video/mp4', mp4(11)),
    VideoMedia('video', 'video/mp4', mp4(0)),
    VideoMedia('video', 'video/mp4', b'not-an-mp4'),
    VideoMedia('image', 'image/png', b'not-a-png'),
    VideoMedia('image', 'image/png', b'\x89PNG\r\n\x1a\n' + b'x' * 20_000_000),
])
def test_invalid_media_is_rejected_before_encoding(bad):
    with pytest.raises(ValueError):
        omni_request(PROJECT, 'Referencia', (IMAGE, bad))


def test_unsupported_combinations_and_project_are_rejected():
    with pytest.raises(ValueError, match='imagen'):
        omni_request(PROJECT, 'Referencia', (VIDEO,))
    with pytest.raises(ValueError, match='imagen'):
        omni_request(PROJECT, 'Referencia', (IMAGE, IMAGE))
    with pytest.raises(ValueError, match='Proyecto'):
        veo_request('foreign/project', 'veo-3.1-fast-generate-001', 'Cubo')


def test_mp4_duration_is_read_from_bytes_not_supplied_by_client():
    assert mp4_duration_seconds(VIDEO.data) == 3
    with pytest.raises(ValueError, match='Tamaño de caja'):
        mp4_duration_seconds(VIDEO.data[:-1])


def test_veo_operation_scope_and_completed_video():
    model = 'veo-3.1-fast-generate-001'
    name = (f'projects/{PROJECT}/locations/us-central1/publishers/google/'
            f'models/{model}/operations/one-test-operation')
    assert veo_operation_name(PROJECT, model, {'name': name}) == name
    recovery = veo_recovery_request(PROJECT, model, name)
    assert recovery.method == 'POST'
    assert recovery.endpoint.endswith(f'{model}:fetchPredictOperation')
    assert recovery.body == {'operationName': name}
    with pytest.raises(ValueError, match='no pertenece'):
        veo_operation_name('another-project', model, {'name': name})
    response = {'name': name, 'done': True, 'response': {'videos': [{
        'mimeType': 'video/mp4',
        'bytesBase64Encoded': b64encode(VIDEO.data).decode()}]}}
    outputs = veo_completed(response, name)
    assert len(outputs) == 1 and outputs[0].data == VIDEO.data
    assert len(outputs[0].sha256) == 64
    assert outputs[0].duration_seconds == 3
    assert (outputs[0].width_pixels, outputs[0].height_pixels,
            outputs[0].frame_rate) == (640, 360, 24)
    with pytest.raises(ValueError, match='no ha terminado'):
        veo_completed({**response, 'done': False}, name)
    with pytest.raises(ValueError, match='no ha terminado'):
        veo_completed(response, name + '-other')


def test_omni_completed_extracts_only_model_output_video():
    response = {'model': 'gemini-omni-1.1-flash-preview', 'status': 'completed',
                'usage': {'total_tokens': 100}, 'steps': [
                    {'type': 'thought', 'summary': [{'type': 'text', 'text': 'plan'}]},
                    {'type': 'model_output', 'content': [{
                        'type': 'video', 'mime_type': 'video/mp4',
                        'data': b64encode(VIDEO.data).decode()}]}]}
    output = omni_completed(response)[0]
    assert output.data == VIDEO.data and output.usage == {'total_tokens': 100}
    assert output.duration_seconds == 3
    with pytest.raises(ValueError, match='no ha terminado'):
        omni_completed({**response, 'status': 'in_progress'})
    with pytest.raises(ValueError, match='no parece un MP4'):
        omni_completed({**response, 'steps': [
            {'type': 'model_output', 'content': [{
                'type': 'video', 'mime_type': 'video/mp4',
                'data': b64encode(b'not-mp4').decode()}]}]})


def test_omni_completed_uri_stays_under_the_approved_prefix():
    response = {'model': 'gemini-omni-1.1-flash-preview',
                'status': 'completed', 'usage': {'total_tokens': 123},
                'steps': [{'type': 'model_output', 'content': [{
                    'type': 'video', 'mime_type': 'video/mp4',
                    'uri': 'gs://private-bucket/creative/attempt/output.mp4'}]}]}
    outputs = omni_completed_uris(
        response, 'gs://private-bucket/creative/attempt/')
    assert outputs[0].uri.endswith('/output.mp4')
    assert outputs[0].usage == {'total_tokens': 123}
    outside = {**response, 'steps': [{'type': 'model_output', 'content': [{
        'type': 'video', 'mime_type': 'video/mp4',
        'uri': 'gs://private-bucket/creative/attempt-other/output.mp4'}]}]}
    with pytest.raises(ValueError, match='prefijo GCS autorizado'):
        omni_completed_uris(outside, 'gs://private-bucket/creative/attempt/')


def test_omni_recovery_requires_a_safe_stored_interaction_id():
    recovery = omni_recovery_request(PROJECT, 'v1_sample_123')
    assert recovery.method == 'GET' and recovery.body is None
    assert recovery.endpoint.endswith('/interactions/v1_sample_123')
    with pytest.raises(ValueError, match='Identificador'):
        omni_recovery_request(PROJECT, '../other-project')
