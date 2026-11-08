"""Los estáticos separan fotografía generativa y copy determinista."""

from dataclasses import replace
from hashlib import sha256
from pathlib import Path

import pytest

from app.creative_image_contracts import ImageOutput, image_dimensions
from app.creative_image_direction import (compile_directed_image,
                                          evaluate_directed_image)
from app.creative_planning import AUDITED_PROJECT
from app.creative_skill_compiler import compile_skill_plan
from app.creative_strategy_contract import bind_strategy


AUDIT = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results')


def setup():
    compilation = compile_skill_plan({
        'recipe': 'service_offer',
        'objective': 'Presentar una sesión inicial con un siguiente paso claro',
        'audience': 'Personas que comparan servicios de planificación',
        'offer': 'Sesión inicial de planificación',
        'cta': 'Reservar una sesión',
        'sourceMode': 'uony_concept',
    }, AUDITED_PROJECT)
    context = {
        'purchaseSituation': 'La persona compara servicios antes de reservar.',
        'motivation': 'Quiere un siguiente paso claro tras la primera sesión.',
        'objection': 'No sabe qué recibirá después de la conversación inicial.',
        'persuasionIdea': 'Mostrar con claridad la sesión y su entregable real.',
        'hypothesis': 'Una oferta concreta reducirá la incertidumbre de reserva.',
        'destination': 'https://uonify.example/reservar',
        'primaryMetric': 'qualified_lead',
        'claims': [{
            'claimId': 'claim-01', 'statement': 'La sesión incluye un plan escrito.',
            'basis': 'user_provided', 'sourceRef': 'brief://service/offer',
            'allowedInMedia': True,
        }],
        'beats': [{
            'unitId': 'image-01',
            'buyerQuestion': '¿Qué recibiré al terminar la sesión?',
            'newInformation': 'La oferta incluye un plan escrito de siguientes pasos.',
            'proofAction': 'Mostrar el entregable autorizado sin datos de clientes.',
            'claimIds': ['claim-01'], 'ctaTiming': 'CTA bajo la oferta.',
        }],
    }
    strategy = bind_strategy(compilation, context)
    direction = {
        'unitId': 'image-01', 'assetPurpose': 'final_static',
        'placement': 'Feed móvil', 'aspectRatio': '1:1',
        'primaryVisual': 'Una mesa clara con el plan escrito como evidencia central',
        'hierarchy': 'Entregable primero, profesional en segundo plano, copy a la derecha',
        'photography': 'Fotografía cotidiana nítida, perspectiva natural y materiales reales',
        'motivatedLight': 'Luz suave de ventana desde la izquierda sobre el documento',
        'occupancy': 'Una persona autorizada, manos plausibles y sin terceros',
        'copySpace': 'Tercio derecho tranquilo sin detalles ni caras',
        'copyManifest': [
            {'role': 'headline', 'exactText': 'Sal con un plan claro'},
            {'role': 'cta', 'exactText': 'Reservar una sesión',
             'destination': 'https://uonify.example/reservar'},
        ],
    }
    return compilation, context, strategy, direction


def real_output():
    data = (AUDIT / 'gemini-3.1-flash-image-1.png').read_bytes()
    width, height = image_dimensions(data, 'image/png')
    return ImageOutput('image/png', data, sha256(data).hexdigest(), width, height)


def test_static_prompt_excludes_exact_copy_and_keeps_it_for_finishing():
    compilation, context, strategy, direction = setup()
    plan = compile_directed_image(
        compilation, strategy, context, direction, project=AUDITED_PROJECT)
    prompt = plan.request.body['contents'][0]['parts'][0]['text']
    assert 'Generate the photographic layer only' in prompt
    assert 'Sal con un plan claro' not in prompt and 'Reservar una sesión' not in prompt
    assert plan.direction.copyManifest[1].exactText == 'Reservar una sesión'
    assert len(plan.direction_sha256) == 64
    assert not plan.approval_ready and not plan.execution_authorized


def test_real_google_image_passes_technical_checks_but_needs_human_review():
    compilation, context, strategy, direction = setup()
    plan = compile_directed_image(
        compilation, strategy, context, direction, project=AUDITED_PROJECT)
    result = evaluate_directed_image(plan, real_output())
    assert result.automatic_passed and result.human_review_required
    assert not result.accepted_for_use
    assert any('reproduce exactamente' in check for check in result.human_checks)


def test_tampered_output_and_changed_cta_destination_are_rejected():
    compilation, context, strategy, direction = setup()
    wrong = {**direction, 'copyManifest': [*direction['copyManifest'][:-1], {
        'role': 'cta', 'exactText': 'Reservar una sesión',
        'destination': 'https://example.invalid'}]}
    with pytest.raises(ValueError, match='destino'):
        compile_directed_image(
            compilation, strategy, context, wrong, project=AUDITED_PROJECT)
    plan = compile_directed_image(
        compilation, strategy, context, direction, project=AUDITED_PROJECT)
    result = evaluate_directed_image(
        plan, replace(real_output(), sha256='0' * 64))
    assert result.automatic_issues == (
        'SHA-256 declarado no coincide con los bytes',)


def test_strategy_change_invalidates_the_image_compilation():
    compilation, context, strategy, direction = setup()
    changed = {**context, 'hypothesis':
               'Una descripción distinta exige volver a validar la estrategia.'}
    with pytest.raises(ValueError, match='cambió'):
        compile_directed_image(
            compilation, strategy, changed, direction, project=AUDITED_PROJECT)


def test_copy_change_keeps_photo_request_but_changes_finishing_fingerprint():
    compilation, context, strategy, direction = setup()
    first = compile_directed_image(
        compilation, strategy, context, direction, project=AUDITED_PROJECT)
    changed = {**direction, 'copyManifest': [
        {'role': 'headline', 'exactText': 'Obtén un plan claro'},
        direction['copyManifest'][1],
    ]}
    second = compile_directed_image(
        compilation, strategy, context, changed, project=AUDITED_PROJECT)
    assert first.request_sha256 == second.request_sha256
    assert first.direction_sha256 != second.direction_sha256
