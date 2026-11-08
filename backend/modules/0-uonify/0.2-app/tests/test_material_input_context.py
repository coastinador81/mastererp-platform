"""La procedencia del prompt no es evidencia visual ni un nuevo conflicto del cliente."""
from copy import deepcopy
import json
from pathlib import Path
import pytest
from app.product_materials_facts import consolidate_proposals
from app.product_materials_review import groups_of
from app.product_materials_values import normalize_value


@pytest.mark.parametrize('value', ['China', 'Fabricado en China', 'Made in China', 'Fabricado en China / Made in China'])
def test_country_label_variants_have_same_key_without_translating_or_choosing(value):
    assert normalize_value('custom:pais_fabricacion', value) == ('china', 'China', None)
    assert normalize_value('custom:pais_fabricacion', 'Fabricado en China / Made in Taiwan')[0] != 'china'
    assert normalize_value('custom:pais_fabricacion', 'No fabricado en China')[0] != 'china'


@pytest.mark.parametrize('excerpt', ['Producto objetivo declarado: Nombre de prueba',
                                   'Datos declarados por cliente para Nombre de prueba',
                                   'Nombre de prueba según el contexto de entrada'])
def test_prompt_context_is_rejected_as_image_evidence_but_literal_ocr_remains_observation(excerpt):
    source = {'id': 's', 'name': 'producto.png', 'version': 'v1'}
    fragments = [{'id': 'visual', 'source_id': 's', 'version': 'v1', 'payload': {
        'image': {'width': 100}, 'visualLocator': 'Imagen 1',
        'segments': [{'locator': 'OCR 1', 'text': excerpt, 'method': 'ocr', 'observational': True}]}}]
    proposal = {'id': 'name', 'field': 'name', 'label': 'Nombre', 'value': 'Nombre de prueba',
                'evidence': [{'sourceId': 's', 'locator': 'Imagen 1', 'excerpt': excerpt}]}
    result = consolidate_proposals([proposal], [source], fragments)
    assert result['proposals'][0]['supportStatus'] == 'unsupported'
    assert result['rejections'][0]['code'] == 'input_context'
    assert not result['rejections'][0]['recovered']
    proposal['evidence'][0]['locator'] = 'OCR 1'
    result = consolidate_proposals([proposal], [source], fragments)
    assert result['proposals'][0]['supportStatus'] == 'needs_review'
    assert result['proposals'][0]['evidence'][0]['method'] == 'ocr'


def name_case(other_name='Nombre guardado', product_name='Nombre guardado'):
    sources = [{'id': key, 'name': key + '.png', 'version': 'v1'} for key in ('old', 'current')]
    sources.append({'id': 'document', 'name': 'Ficha.json', 'version': 'v1'})
    fragments = [{'id': key, 'source_id': key, 'version': 'v1', 'payload': {'image': {'width': 100}}}
                 for key in ('old', 'current')]
    fragments.append({'id': 'document', 'source_id': 'document', 'version': 'v1',
                      'payload': {'segments': [{'locator': '$.product', 'text': '"Nombre original"'}]}})
    proposals = [{'id': key, 'field': 'name', 'label': 'Nombre', 'value': value,
                  'evidence': [{'sourceId': key, 'locator': 'Imagen', 'excerpt': value}]}
                 for key, value in [('old', 'Nombre original'), ('current', other_name)]]
    proposals.append({'id': 'document', 'field': 'name', 'label': 'Nombre', 'value': 'Nombre original',
                      'status': 'confirmed', 'confirmedValue': product_name, 'confirmationOrigin': 'user_declared',
                      'evidence': [{'sourceId': 'document', 'locator': '$.product', 'excerpt': 'Nombre original'}]})
    return consolidate_proposals(proposals, sources, fragments, product={'name': product_name})


def test_confirmed_name_keeps_historical_discrepancy_without_another_question():
    result = name_case()
    assert result['summary']['conflictCount'] == 0
    assert groups_of(result['proposals']) == []
    visual = [p for p in result['proposals'] if p['claimType'] == 'visual_observation']
    assert {p['value'] for p in visual} == {'Nombre original', 'Nombre guardado'}
    assert all(p['supportStatus'] == 'needs_review' and p['evidence'] for p in visual)
    confirmed = next(p for p in result['proposals'] if p['status'] == 'confirmed')
    assert confirmed['value'] == 'Nombre original' and confirmed['confirmedValue'] == 'Nombre guardado'


def test_new_different_name_still_needs_review_and_keeps_real_conflict():
    result = name_case('Otro nombre')
    assert result['summary']['conflictCount'] == 1
    assert groups_of(result['proposals'])[0][0]['value'] == 'Otro nombre'


def test_basic_mini_bricks_recorded_citations_have_no_prompt_or_country_pending_conflict():
    path = Path('/data12-corpus/final-live.json')
    if not path.exists():
        pytest.skip('El corpus del piloto DATA-12 no está montado.')
    recorded = json.loads(path.read_text())
    # Reproduce exclusivamente las referencias visuales conservadas y la cita JSON
    # del nombre, sin leer Drive, llamar a IA ni modificar la ficha del piloto.
    selected = [p for p in recorded['result']['facts']['proposals'] if
                (p['canonicalField'] in ('name', 'custom:pais_fabricacion') and
                 p['claimType'] == 'visual_observation') or
                (p['canonicalField'] == 'name' and p['status'] == 'confirmed')]
    fragments = {}
    for proposal in selected:
        for evidence in proposal['evidence']:
            payload = ({'segments': [{'locator': evidence['locator'], 'text': evidence['excerpt'],
                                     **{k: evidence[k] for k in ('method', 'observational') if k in evidence}}]}
                       if evidence.get('method') == 'ocr' or proposal['claimType'] != 'visual_observation'
                       else {'image': {'width': evidence.get('region', {}).get('width', 100)},
                             'visualLocator': evidence['locator'], 'region': evidence.get('region')})
            fragments[evidence['fragmentId']] = {'id': evidence['fragmentId'], 'source_id': evidence['sourceId'],
                                               'version': evidence['sourceVersion'], 'payload': payload}
    result = consolidate_proposals(deepcopy(selected), recorded['sources'], list(fragments.values()),
                                   product=recorded['product']['data'])
    assert result['summary']['conflictCount'] == 0
    assert not any(group[0]['canonicalField'] == 'name' for group in groups_of(result['proposals']))
    country = [p for p in result['proposals'] if p['canonicalField'] == 'custom:pais_fabricacion']
    assert len(country) == 1 and country[0]['value'] == 'China'
    assert 'Fabricado en China / Made in China' in country[0]['originalValues']
    # El snapshot reconciliado conserva estos rechazos en el registro, ya no como
    # evidencia del hecho; no inventarlos al reconstruir sólo citas aceptadas.
    assert not any('Producto objetivo declarado:' in e['excerpt'] for p in result['proposals'] for e in p['evidence'])
    assert not any(p['canonicalField'] == 'name' and p['value'] == recorded['product']['data']['name']
                   and p['supportStatus'] == 'supported' for p in result['proposals'])
