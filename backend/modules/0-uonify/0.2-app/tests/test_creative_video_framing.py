"""El montaje recibe escala explícita; no confía en el valor 100 % del editor."""

from pathlib import Path

import pytest

from app.creative_video_contracts import VideoOutput, mp4_video_geometry
from app.creative_video_framing import frame_for_canvas


AUDIT = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results')


def output(name):
    data = (AUDIT / name).read_bytes()
    width, height, frame_rate = mp4_video_geometry(data)
    return VideoOutput('video/mp4', data, '0' * 64, 1,
                       width, height, frame_rate)


def test_real_omni_and_veo_clips_have_different_required_scale_for_hd():
    omni = output('gemini-omni-1.1-flash-preview-1.mp4')
    veo = output('veo-3.1-fast-generate-001-poll-1792279452-1.mp4')
    assert (omni.width_pixels, omni.height_pixels, omni.frame_rate) == (640, 360, 24)
    assert (veo.width_pixels, veo.height_pixels, veo.frame_rate) == (1280, 720, 24)
    assert frame_for_canvas(omni, 1280, 720, 'cover').uniform_scale_percent == 200
    assert frame_for_canvas(veo, 1280, 720, 'cover').uniform_scale_percent == 100


def test_contain_and_cover_make_letterbox_or_crop_explicit():
    portrait = VideoOutput('video/mp4', b'bytes', '0' * 64, 3,
                           720, 1280, 24)
    contain = frame_for_canvas(portrait, 1280, 720, 'contain')
    cover = frame_for_canvas(portrait, 1280, 720, 'cover')
    assert contain.letterbox_width == 875 and contain.crop_height == 0
    assert cover.crop_height == 1556 and cover.letterbox_width == 0
    with pytest.raises(ValueError, match='elegir'):
        frame_for_canvas(portrait, 1280, 720, 'automatic')
