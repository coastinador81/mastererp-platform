"""Cambiar cualquier insumo material invalida la huella aprobable."""

from dataclasses import replace

import pytest

from app.creative_image_contracts import ImageMedia, image_request
from app.creative_music_contracts import music_request
from app.creative_request_fingerprint import fingerprint
from app.creative_video_contracts import VideoMedia, veo_request
from app.creative_voiceover_contracts import voiceover_request


PROJECT = 'uonify-757ec8c3ab3245ffa45d'
IMAGE = b'\x89PNG\r\n\x1a\nsynthetic'


def test_fingerprint_is_stable_only_for_the_exact_video_request():
    request = veo_request(PROJECT, 'veo-3.1-fast-generate-001',
                          'Cubo azul', VideoMedia('image', 'image/png', IMAGE))
    same = veo_request(PROJECT, 'veo-3.1-fast-generate-001',
                       'Cubo azul', VideoMedia('image', 'image/png', IMAGE))
    changed_prompt = veo_request(PROJECT, 'veo-3.1-fast-generate-001',
                                 'Cubo rojo', VideoMedia('image', 'image/png', IMAGE))
    changed_asset = veo_request(PROJECT, 'veo-3.1-fast-generate-001',
                                'Cubo azul', VideoMedia('image', 'image/png', IMAGE + b'x'))
    original = fingerprint(request)
    assert original == fingerprint(same)
    assert len(original.sha256) == 64 and len(original.input_hashes) == 1
    assert original.sha256 != fingerprint(changed_prompt).sha256
    assert original.sha256 != fingerprint(changed_asset).sha256


def test_fingerprint_binds_image_reference_and_project():
    first = image_request(PROJECT, 'gemini-3.1-flash-image', 'Conserva el cubo',
                          ImageMedia('image/png', IMAGE))
    other_project = image_request('another-valid-project', 'gemini-3.1-flash-image',
                                  'Conserva el cubo', ImageMedia('image/png', IMAGE))
    assert fingerprint(first).sha256 != fingerprint(other_project).sha256
    assert fingerprint(first).input_hashes == fingerprint(other_project).input_hashes
    with pytest.raises(ValueError, match='Manifiesto'):
        fingerprint(replace(first, input_manifest=({'kind': 'image'},)))


def test_fingerprint_binds_voiceover_and_music_to_exact_script_or_prompt():
    voice = fingerprint(voiceover_request(PROJECT, 'Un nuevo mundo'))
    other_voice = fingerprint(voiceover_request(PROJECT, 'Otro mundo'))
    music = fingerprint(music_request(PROJECT, 'Piano suave'))
    other_music = fingerprint(music_request(PROJECT, 'Piano rápido'))
    assert voice.sha256 != other_voice.sha256
    assert music.sha256 != other_music.sha256
    assert voice.input_hashes == music.input_hashes == ()
    assert voice.model == 'gemini-2.5-flash-tts'
    assert music.model == 'lyria-3-clip-preview'
