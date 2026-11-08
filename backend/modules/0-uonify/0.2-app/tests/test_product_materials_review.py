"""Revisión de hechos consolidados sobre compositor: evidencia, conflictos y decisiones únicas."""
from copy import deepcopy
import pytest
from app.product_materials_guide import ACCEPT, REJECT
from app.product_materials_review import already_current, label_of, custom_id, fingerprint
from test_product_materials_guide import setup, review, answer, message


def fact(identifier, field, label, value, **extra):
    return {'id': identifier, 'field': field, 'canonicalField': field, 'label': label, 'value': value,
            'status': 'proposed', 'scope': 'product', 'claimType': 'declared', 'channel': 'product',
            'supportStatus': 'supported', 'reviewable': True, 'sourceProposalIds': [identifier + '-raw'],
            'evidence': [{'sourceId': 'source1', 'locator': 'Página 2', 'excerpt': label + ': ' + value,
                          'sourceVersion': '2026-10-14', 'fragmentId': 'fragment1', 'citationId': identifier + '-citation'}], **extra}


def with_facts(materials, proposals):
    materials.job['facts'] = {'version': 1, 'proposals': proposals}


def test_many_material_facts_are_not_a_client_question_queue(setup):
    client, _, _, materials, _ = setup
    with_facts(materials, [fact(str(i), 'custom:design_' + str(i), 'Diseño ' + str(i), str(i), claimType='nominal') for i in range(80)])
    original = deepcopy(materials.job['facts'])
    form = review(client, materials)
    assert form['context']['section'] == 'amazon_requirements'
    assert form['context']['step'] == 'source'
    assert materials.job['facts'] == original


def test_confirmed_and_rejected_facts_remain_unchanged_in_new_workflow(setup):
    client, _, _, materials, product = setup
    with_facts(materials, [fact('age', 'custom:edad_minima', 'Edad mínima', '36 meses', status='confirmed',
                              confirmedValue='36 meses', confirmationOrigin='documentary'),
                          fact('other', 'custom:material', 'Material', 'Plástico', status='rejected')])
    original = deepcopy(materials.job['facts'])
    review(client, materials)
    assert materials.job['facts'] == original
    current = client.get('/api/products').json()['products'][0]
    assert current['customFields'] == product['customFields'] and current['name'] == product['name']


def test_nominal_design_visual_observations_and_unknown_species_do_not_gate_amazon(setup):
    client, _, _, materials, _ = setup
    with_facts(materials, [fact('nominal', 'custom:dimensiones_pieza', 'Dimensiones', '75 × 25 × 15 mm', claimType='nominal'),
        fact('visual', 'custom:material', 'Material', 'Madera', supportStatus='needs_review', claimType='visual_observation'),
        fact('wood', 'custom:material', 'Material', 'Madera', originalValues=['Madera; especie pendiente'])])
    form = review(client, materials)
    assert form['context']['section'] == 'amazon_requirements'
    assert form['fields'][0]['id'] == 'source'


@pytest.mark.parametrize('extra', [
    {'operation': 'reconcile'}, {'operation': 'upgrade_readers'}, {'operation': 'repair_evidence'},
    {'reconciliation': {'status': 'running'}}, {'pauseReason': 'source_changed'},
    {'error': {'code': 'permission_denied'}}, {'error': {'code': 'reauthorize'}},
])
def test_pending_source_verification_blocks_old_fact_review(setup, extra):
    client, _, _, materials, _ = setup
    with_facts(materials, [fact('wood', 'custom:material', 'Material', 'Madera')])
    materials.job.update(extra)
    result = client.post('/api/uony/messages', json=message(materialAction={'action': 'review', 'sku': 'DRIVE-01', 'analysisId': materials.job['id']}))
    assert result.status_code == 409


def test_stale_facts_block_review_until_source_revalidation(setup):
    client, _, _, materials, _ = setup
    with_facts(materials, [fact('wood', 'custom:material', 'Material', 'Madera')])
    materials.job['facts']['stale'] = True
    result = client.post('/api/uony/messages', json=message(materialAction={'action': 'review', 'sku': 'DRIVE-01', 'analysisId': materials.job['id']}))
    assert result.status_code == 409


def test_scope_without_source_name_has_readable_fallback():
    proposal = fact('scoped', 'custom:inscripcion', 'Inscripción', 'Hola', scope='asset:opaque-drive-id')
    assert label_of(proposal) == 'Inscripción · recurso de origen'
