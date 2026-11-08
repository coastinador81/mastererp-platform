"""La estrategia solo queda lista con evidencia y beats trazables."""

import pytest

from app.creative_planning import AUDITED_PROJECT
from app.creative_skill_compiler import compile_skill_plan
from app.creative_strategy_contract import bind_strategy


def commercial_compilation(recipe='review_card'):
    return compile_skill_plan({
        'recipe': recipe,
        'objective': 'Presentar una experiencia auténtica con el servicio',
        'audience': 'Personas que comparan servicios antes de reservar',
        'offer': 'Sesión inicial de planificación',
        'evidence': 'Testimonio firmado y autorizado por la clienta',
        'cta': 'Reservar una sesión',
        'sourceMode': 'provided',
    }, AUDITED_PROJECT)


def context(**overrides):
    value = {
        'purchaseSituation': 'La persona compara alternativas antes de reservar.',
        'motivation': 'Quiere reducir incertidumbre sobre el proceso inicial.',
        'objection': 'Duda de que la sesión produzca un siguiente paso concreto.',
        'persuasionIdea': 'Mostrar una experiencia verificable y el entregable real.',
        'hypothesis': 'La prueba auténtica y un CTA preciso reducirán la incertidumbre.',
        'destination': 'https://uonify.example/reservar',
        'primaryMetric': 'qualified_lead',
        'claims': [{
            'claimId': 'claim-01',
            'statement': 'La clienta recibió un plan escrito tras su sesión.',
            'basis': 'user_provided',
            'sourceRef': 'asset://evidence/testimonial-01',
            'allowedInMedia': True,
        }],
        'beats': [{
            'unitId': 'image-01',
            'buyerQuestion': '¿Qué obtendré realmente al terminar la sesión?',
            'newInformation': 'La pieza muestra el entregable descrito por la clienta.',
            'proofAction': 'Citar el testimonio autorizado junto al entregable.',
            'claimIds': ['claim-01'],
            'ctaTiming': 'CTA visible después de la prueba.',
        }],
        'excludedClaims': ['resultados económicos no aportados'],
    }
    value.update(overrides)
    return value


def test_authentic_review_strategy_is_bound_but_never_executes():
    result = bind_strategy(commercial_compilation(), context())
    assert result.strategy_ready and not result.execution_authorized
    assert len(result.strategy_sha256) == 64 and result.blockers == ()


def test_proposal_cannot_masquerade_as_review_evidence():
    value = context(claims=[{
        'claimId': 'claim-01',
        'statement': 'La sesión duplicará las ventas.',
        'basis': 'proposal',
        'allowedInMedia': False,
    }])
    result = bind_strategy(commercial_compilation(), value)
    assert not result.strategy_ready
    assert 'claim-01 no está autorizado' in result.blockers[0]
    assert 'prueba factual auténtica' in result.blockers[-1]


def test_missing_destination_proof_action_and_cta_remain_explicit_blockers():
    value = context(destination=None)
    value['beats'][0]['proofAction'] = None
    value['beats'][0]['ctaTiming'] = None
    result = bind_strategy(commercial_compilation('service_offer'), value)
    assert result.blockers == (
        'image-01: definir una acción o soporte de prueba',
        'definir destino real del CTA',
        'ubicar el CTA en una unidad concreta')


def test_beats_must_match_compiled_units_exactly():
    compilation = compile_skill_plan({
        'recipe': 'cinematic_video',
        'objective': 'Ciudad futurista bajo la lluvia nocturna',
        'sourceMode': 'uony_concept',
        'modelChoice': 'veo-3.1-generate-001',
        'durationSeconds': 9,
    }, AUDITED_PROJECT)
    value = context(destination=None, claims=[], beats=[{
        'unitId': 'shot-01',
        'buyerQuestion': '¿Dónde comienza la historia visual?',
        'newInformation': 'La ciudad aparece bajo la lluvia nocturna.',
    }])
    with pytest.raises(ValueError, match='exactamente'):
        bind_strategy(compilation, value)
