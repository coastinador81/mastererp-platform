"""La revisión completa acredita un test, nunca conversión ni publicación."""

from datetime import datetime, timezone

import pytest

from app.creative_image_direction import ImageEvaluation
from app.creative_media_evaluation import BatchEvaluation, ShotEvaluation
from app.creative_review_contract import decide_image_review, decide_video_review


ARTIFACT = 'asset://video/final-v1'


def evaluation(passed=True):
    shot = ShotEvaluation('shot-01', 'a' * 64, passed,
                          () if passed else ('duración inválida',),
                          ('revisar propósito',), None)
    return BatchEvaluation('b' * 64, (shot,), passed)


def coverage(**overrides):
    value = {
        'artifactRef': ARTIFACT,
        'fullVideoPlayed': True,
        'audioReviewed': True,
        'fullResolutionInspected': True,
        'intendedDisplaySizeInspected': True,
        'tracksVerified': True,
        'sampledFramesSeconds': [0, 1.5, 2.9],
    }
    value.update(overrides)
    return value


def verdicts(value='pass', *, gate_fix=None):
    result = []
    for gate in ('factual', 'commercial', 'realism_design',
                 'video_sound', 'technical'):
        current = value if gate_fix is None or gate == gate_fix else 'pass'
        result.append({
            'gate': gate, 'verdict': current,
            'severity': 'none' if current == 'pass' else 'medium',
            'artifactRef': ARTIFACT,
            'sourceRef': 'plan://creative/current',
            'observedAt': datetime(2026, 10, 18, tzinfo=timezone.utc),
            'consequence': ('Cumple el criterio registrado.' if current == 'pass'
                            else 'La salida no puede pasar a prueba.'),
            'owner': 'revisión creativa',
            'smallestFix': None if current == 'pass' else 'Corregir solo el plano afectado.',
        })
    return tuple(result)


def test_complete_review_is_ready_for_test_but_never_proven_to_convert():
    result = decide_video_review(evaluation(), coverage(), verdicts())
    assert result.reviewed_for_test and result.release_state == 'reviewed_for_test'
    assert not result.repair_required and not result.proven_to_convert


def test_sampled_frames_without_full_playback_and_audio_stay_unverified():
    values = list(verdicts())
    values[3] = {**values[3], 'verdict': 'unverified', 'severity': 'low',
                 'smallestFix': 'Reproducir vídeo y audio completos.',
                 'consequence': 'Movimiento, ritmo y audio no están verificados.'}
    result = decide_video_review(
        evaluation(), coverage(fullVideoPlayed=False, audioReviewed=False),
        tuple(values))
    assert result.release_state == 'partial/blocked' and not result.reviewed_for_test
    assert 'reproducir el vídeo completo' in result.blockers[0]
    assert not result.repair_required


def test_revision_requests_smallest_fix_and_sets_repair_state():
    values = list(verdicts())
    values[2] = {**values[2], 'verdict': 'revise', 'severity': 'high',
                 'smallestFix': 'Regenerar shot-01 conservando las demás tomas.',
                 'consequence': 'La identidad cambia durante la acción.'}
    result = decide_video_review(evaluation(), coverage(), tuple(values))
    assert result.repair_required and not result.reviewed_for_test
    assert any('realism_design: revise' in item for item in result.blockers)


def test_missing_technical_precondition_or_incomplete_gate_set_is_rejected():
    result = decide_video_review(evaluation(False), coverage(), verdicts())
    assert result.blockers[0] == 'resolver fallos técnicos automáticos por toma'
    with pytest.raises(ValueError, match='todos los gates'):
        decide_video_review(evaluation(), coverage(), verdicts()[:-1])


def image_coverage(**overrides):
    value = {
        'artifactRef': ARTIFACT,
        'fullResolutionInspected': True,
        'intendedDisplaySizeInspected': True,
        'cropAndOverlayPreviewInspected': True,
        'exactCopyInspected': True,
    }
    value.update(overrides)
    return value


def image_verdicts():
    return tuple(item for item in verdicts()
                 if item['gate'] != 'video_sound')


def test_complete_static_review_is_ready_for_test_not_publication():
    evaluated = ImageEvaluation('c' * 64, True, (), ('revisar copy',))
    result = decide_image_review(evaluated, image_coverage(), image_verdicts())
    assert result.reviewed_for_test and not result.proven_to_convert


def test_static_without_mobile_crop_or_copy_review_stays_blocked():
    evaluated = ImageEvaluation('c' * 64, True, (), ('revisar copy',))
    result = decide_image_review(
        evaluated,
        image_coverage(intendedDisplaySizeInspected=False,
                       cropAndOverlayPreviewInspected=False,
                       exactCopyInspected=False),
        image_verdicts())
    assert not result.reviewed_for_test and len(result.blockers) == 3


def test_static_requires_four_ordered_gates():
    evaluated = ImageEvaluation('c' * 64, True, (), ('revisar copy',))
    with pytest.raises(ValueError, match='imagen debe contener'):
        decide_image_review(
            evaluated, image_coverage(), tuple(reversed(image_verdicts())))
