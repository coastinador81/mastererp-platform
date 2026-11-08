"""Las discrepancias visuales se resuelven por chat sin cambiar el atributo confirmado."""
from copy import deepcopy
import pytest
from app.product_materials_guide import ACCEPT, RESOURCE_NOTICE
from app.product_materials_observations import READING_INCORRECT, RESOURCE_INCORRECT, UNABLE_TO_CHECK, ALTERNATIVE_WORDING
from app.product_materials_decisions import restore_decisions
from app.product_materials_review import fingerprint
from test_product_materials_guide import setup, review, answer, message
from test_product_materials_review import fact, with_facts


def prepare(materials):
    reference = fact('manufacturer', 'custom:fabricante', 'Fabricante', 'Empresa & Servicios LLC',
                     status='confirmed', confirmedValue='Empresa & Servicios LLC', reviewedRevision=3)
    image = fact('ocr', 'custom:fabricante', 'Fabricante', 'Empresa 8 Servicios LLC',
                 claimType='visual_observation', supportStatus='needs_review')
    with_facts(materials, [reference, image])


def test_visual_discrepancies_are_retained_without_requesting_an_irrelevant_product_answer(setup):
    client, _, _, materials, _ = setup
    prepare(materials)
    original = deepcopy(materials.job['facts'])
    form = review(client, materials)
    assert form['context']['section'] == 'amazon_requirements'
    assert all('resourceEvidence' not in field for field in form['fields'])
    assert materials.job['facts'] == original


def test_existing_resource_resolutions_are_not_reset_when_amazon_preparation_starts(setup):
    client, _, _, materials, _ = setup
    prepare(materials)
    observation = materials.job['facts']['proposals'][1]
    observation.update(resolution={'status': 'awaiting_source', 'requiredAction': 'replace_source'},
                       reviewDecision='resource_incorrect')
    original = deepcopy(materials.job['facts'])
    review(client, materials)
    assert materials.job['facts'] == original


def test_incompatible_pending_resolutions_are_preserved_instead_of_choosing_one():
    first = fact('first', 'EAN', 'EAN', '8435833200006', resolution={'status': 'awaiting_source', 'requiredAction': 'replace_source'})
    second = {**first, 'id': 'second', 'resolution': {'status': 'awaiting_client', 'requiredAction': 'review_resource'}}
    current = {key: value for key, value in first.items() if key != 'resolution'}
    current['id'] = 'current'
    restore_decisions({'proposals': [current]}, [first, second])
    assert 'resolution' not in current
    assert {item['resolution']['status'] for item in current['previousDecisions']} == {'awaiting_source', 'awaiting_client'}


def test_pending_resource_decision_survives_reconcile_but_not_a_new_source_version():
    old = fact('ocr', 'custom:fabricante', 'Fabricante', 'Empresa 8 Servicios LLC',
               claimType='visual_observation', supportStatus='needs_review',
               resolution={'status': 'awaiting_source', 'requiredAction': 'replace_source'},
               reviewDecision='resource_incorrect')
    current = deepcopy(old)
    current.pop('resolution'); current.pop('reviewDecision')
    restore_decisions({'proposals': [current]}, [old])
    assert current['resolution'] == old['resolution']
    current.pop('resolution'); current.pop('reviewDecision')
    current['evidence'][0]['sourceVersion'] = 'new-version'
    restore_decisions({'proposals': [current]}, [old])
    assert 'resolution' not in current and current['status'] == 'proposed'
