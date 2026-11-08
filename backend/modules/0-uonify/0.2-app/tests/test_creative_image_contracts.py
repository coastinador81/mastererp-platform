"""Pruebas offline de la ruta auditada de imágenes."""

from base64 import b64decode, b64encode

import pytest

from app.creative_image_contracts import (ImageMedia, image_completed,
                                          image_dimensions, image_request)


PROJECT = 'uonify-757ec8c3ab3245ffa45d'
MODELS = ('gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3-pro-image')
PNG = (b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR' +
       (32).to_bytes(4, 'big') + (24).to_bytes(4, 'big') +
       b'\x08\x06\x00\x00\x00' + b'\x00' * 4)


@pytest.mark.parametrize('model', MODELS)
def test_image_request_matches_audited_text_to_image_shape(model):
    request = image_request(PROJECT, model, ' Cubo azul ')
    assert request.endpoint.endswith(f'/models/{model}:generateContent')
    assert request.body['contents'] == [{'role': 'user', 'parts': [{'text': 'Cubo azul'}]}]
    assert request.body['generationConfig']['responseModalities'] == ['TEXT', 'IMAGE']
    assert request.body['generationConfig']['imageConfig'] == {
        'aspectRatio': '1:1', 'imageSize': '1K'}


def test_image_output_skips_internal_thought_parts():
    encoded = b64encode(PNG).decode()
    response = {'modelVersion': MODELS[0], 'candidates': [{
        'finishReason': 'STOP', 'content': {'parts': [
            {'thought': True, 'inlineData': {'mimeType': 'image/png', 'data': encoded}},
            {'text': 'Imagen preparada.'},
            {'inlineData': {'mimeType': 'image/png', 'data': encoded}},
        ]}}]}
    output = image_completed(response, MODELS[0])
    assert len(output) == 1 and output[0].data == PNG
    assert len(output[0].sha256) == 64
    assert (output[0].width_pixels, output[0].height_pixels) == (32, 24)
    with pytest.raises(ValueError, match='modelo distinto'):
        image_completed(response, MODELS[1])


def test_reference_image_edit_contract_is_built_without_provider_call():
    request = image_request(PROJECT, MODELS[1], 'Conserva el cubo azul',
                            ImageMedia('image/png', PNG))
    part = request.body['contents'][0]['parts'][1]['inlineData']
    assert part['mimeType'] == 'image/png' and b64decode(part['data']) == PNG
    assert request.input_manifest[0]['bytes'] == len(PNG)
    assert len(request.input_manifest[0]['sha256']) == 64
    with pytest.raises(ValueError, match='Referencia'):
        image_request(PROJECT, MODELS[1], 'Conserva el cubo azul',
                      ImageMedia('image/png', b'not-a-png'))


def test_image_output_rejects_incomplete_or_malformed_response():
    response = {'modelVersion': MODELS[1], 'candidates': [{
        'finishReason': 'SAFETY', 'content': {'parts': []}}]}
    with pytest.raises(ValueError, match='no terminó'):
        image_completed(response, MODELS[1])
    response['candidates'][0]['finishReason'] = 'STOP'
    response['candidates'][0]['content']['parts'] = [
        {'inlineData': {'mimeType': 'image/png', 'data': b64encode(b'bad').decode()}}]
    with pytest.raises(ValueError, match='Formato'):
        image_completed(response, MODELS[1])


def test_image_request_rejects_unknown_model_or_project():
    with pytest.raises(ValueError, match='Modelo'):
        image_request(PROJECT, 'imagen-4.0-fast-generate-001', 'Cubo azul')
    with pytest.raises(ValueError, match='Proyecto'):
        image_request('../foreign', MODELS[0], 'Cubo azul')


def test_jpeg_and_webp_dimensions_are_read_from_bytes():
    jpeg = (b'\xff\xd8\xff\xc0\x00\x11\x08' +
            (720).to_bytes(2, 'big') + (1280).to_bytes(2, 'big') + b'\x00' * 12)
    assert image_dimensions(jpeg, 'image/jpeg') == (1280, 720)
    width, height = 640, 360
    vp8x = (b'VP8X' + (10).to_bytes(4, 'little') + b'\x00' * 4 +
            (width - 1).to_bytes(3, 'little') +
            (height - 1).to_bytes(3, 'little'))
    webp = b'RIFF' + (len(vp8x) + 4).to_bytes(4, 'little') + b'WEBP' + vp8x
    assert image_dimensions(webp, 'image/webp') == (width, height)
