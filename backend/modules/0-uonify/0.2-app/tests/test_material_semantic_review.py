"""Regresiones del corpus DATA12: citas atómicas, alias, decisiones y ámbitos."""
from copy import deepcopy
import json
from pathlib import Path
import pytest
from app.product_materials_facts import consolidate_proposals
from app.product_materials_decisions import restore_decisions
from app.product_materials_fields import canonical_attribute
from app.product_materials_review import already_current, groups_of
from app.product_materials_values import normalize_value, value_supported


def analyse(label, value, locator, rows, *, extra=None):
    proposal = {'id': 'p', 'field': 'custom:test', 'label': label, 'value': value,
                'evidence': [{'sourceId': 's', 'locator': locator, 'excerpt': value}]}
    proposal.update(extra or {})
    return consolidate_proposals([proposal], [{'id': 's', 'name': 'ficha.json', 'version': 'v1'}],
        [{'id': 'f', 'source_id': 's', 'version': 'v1', 'payload': {
            'segments': [{'locator': key, 'text': text} for key, text in rows]}}])


@pytest.mark.parametrize('label,value,locator', [('Marca', 'UONIFY', '$.brand'),
    ('Nombre del producto', 'Basic Mini Bricks', '$.model'),
    ('País de fabricación', 'China', '$.country_of_manufacture'), ('GTIN', '8435833200006', '$.gtin')])
def test_json_missing_sibling_does_not_contaminate_complete_fields(label, value, locator):
    result = analyse(label, value, locator, [(locator, json.dumps(value)), ('$.missing[0]', '"Peso pendiente"')])
    assert result['proposals'][0]['supportStatus'] == 'supported'
    assert result['rejections'] == []


def test_json_requirements_and_foreign_sku_are_not_product_evidence():
    result = analyse('Material', 'Madera', '$.requirements[0].material',
                     [('$.requirements[0].material', '"Madera"')])
    assert result['proposals'][0]['supportReasons'][0]['code'] == 'missing_value'
    result = analyse('Material', 'Madera', '$.material', [('$.material', '"Madera"'), ('$.sku', '"OTHER"')])
    # Context retains identity even though unrelated root attributes are isolated.
    from app.product_materials_evidence import EvidenceIndex
    index = EvidenceIndex([{'id': 's'}], [{'source_id': 's', 'payload': {'segments': [
        {'locator': '$.material', 'text': 'Madera'}, {'locator': '$.sku', 'text': 'OTHER'}]}}])
    assert '$.sku: OTHER' in index.context(index.by_locator[('s', '$.material')][0])


@pytest.mark.parametrize('label,value,number,unit', [
    ('Niveles de la torre', '18 niveles', '18', 'niveles'),
    ('Parejas de frases distintas', '6 parejas', '6', 'parejas'),
    ('Alternancia entre niveles', '90 grados', '90', 'grados'),
    ('Personajes / servicios', '9 variantes', '9', 'variantes'),
    ('Bloques por servicio', '6 unidades', '6', 'unidades')])
def test_number_and_unit_are_supported_only_by_same_attribute_record(label, value, number, unit):
    locator = '$.fields[0].value'
    rows = [(locator, number), ('$.fields[0].label', json.dumps(label)), ('$.fields[0].unit', json.dumps(unit))]
    result = analyse(label, value, locator, rows, extra={'evidence': [{'sourceId': 's', 'locator': locator, 'excerpt': number}]})
    fact = result['proposals'][0]
    assert fact['supportStatus'] == 'supported'
    assert fact['normalizedValue'] == number
    assert any(e['locator'] == '$.fields[0].label' for e in fact['evidence'][0]['contextEvidence'])
    rows[1] = ('$.fields[0].label', '"Peso del producto"')
    result = analyse(label, value, locator, rows, extra={'evidence': [{'sourceId': 's', 'locator': locator, 'excerpt': number}]})
    assert result['proposals'][0]['supportStatus'] == 'unsupported'


def test_citation_recovery_cannot_borrow_another_variant_even_for_same_value():
    rows = [('$.variants[0].manufacturer', '"Empresa A"'), ('$.variants[1].manufacturer', '"Empresa B"')]
    result = analyse('Fabricante', 'Empresa B', '$.variants[0].manufacturer', rows)
    assert result['proposals'][0]['supportStatus'] == 'unsupported'
    assert all(not rejection['recovered'] for rejection in result['rejections'])


def test_count_units_cannot_borrow_incompatible_dimensions_or_infer_degrees():
    assert not value_supported('custom:alternancia_niveles', '90 grados', '90', '$.fields[0].unit: "radianes"')
    assert not value_supported('custom:alternancia_niveles', '90 grados', '90', '$.angle: 90')
    assert not value_supported('custom:niveles_torre', '18 niveles', '18', '$.fields[0].unit: "kg"')


@pytest.mark.parametrize('qualifier', ['observación no certificada', 'observación no verificada', 'observado en render'])
def test_observation_qualifier_is_metadata_not_a_new_value(qualifier):
    assert value_supported('custom:advertencia', f'0-3 ({qualifier})', '0-3')
    assert not value_supported('custom:advertencia', f'0-3 ({qualifier})', '3+')


def test_languages_require_a_closed_explicit_list_and_do_not_infer_six_languages():
    field = 'custom:idiomas_del_envase'
    assert normalize_value(field, 'Español, inglés, francés, alemán, italiano y portugués')[0] == normalize_value(field, 'ES/EN/FR/DE/IT/PT')[0]
    assert value_supported(field, 'ES/EN/FR', 'Español, inglés y francés')
    assert not value_supported(field, 'ES/EN/FR', 'Español, inglés, francés y alemán')
    assert not value_supported(field, 'ES/EN/FR/DE/IT/PT', 'Seis idiomas')


def test_inscription_aliases_merge_only_same_asset_and_same_explicit_face():
    entries = [('a', 'Frase superior declarada'), ('a', 'Frase impresa visible'),
               ('a', 'Frase inferior declarada'), ('b', 'Texto impreso superior')]
    proposals = [{'id': str(i), 'field': 'custom:text', 'label': label, 'value': 'Hola',
                 'evidence': [{'sourceId': source, 'locator': 'Imagen', 'excerpt': 'Hola'}]}
                for i, (source, label) in enumerate(entries)]
    sources = [{'id': source, 'version': 'v1', 'name': source + '.png'} for source in ('a', 'b')]
    fragments = [{'id': source, 'source_id': source, 'version': 'v1', 'payload': {'image': True}} for source in ('a', 'b')]
    result = consolidate_proposals(proposals, sources, fragments)
    # Both faces say the same thing: generic cannot select one arbitrarily.
    assert len(result['proposals']) == 4
    assert {p['scope'] for p in result['proposals']} == {'asset:a', 'asset:b'}
    result = consolidate_proposals([proposals[i] for i in (0, 1, 3)], sources, fragments)
    assert len(result['proposals']) == 2
    assert sorted(len(p['sourceProposalIds']) for p in result['proposals']) == [1, 2]


def fact(identifier, label, value, **extra):
    field = canonical_attribute('', label)
    key, _, unit = normalize_value(field, value)
    return {'id': identifier, 'field': field, 'canonicalField': field, 'label': label, 'value': value,
            'normalizedValue': key, 'unit': unit, 'scope': 'product', 'channel': 'product',
            'claimType': 'declared', 'status': 'proposed', 'supportStatus': 'supported', 'reviewable': True,
            'supportReason': '', 'sourceProposalIds': [identifier], **extra}


def test_migrated_decision_preserves_value_revision_and_does_not_promote_visual():
    old = fact('old', 'Código de barras EAN-13', '8435833200006', status='confirmed',
               confirmedValue='8435833200006', reviewedRevision=3, confirmationOrigin='documentary')
    new = fact('new', 'EAN', '8435833200006')
    image = fact('image', 'Código de barras EAN-13', '8435833200006', claimType='visual_observation',
                 supportStatus='needs_review', evidence=[{'sourceId': 's', 'sourceVersion': 'v1', 'locator': 'Imagen 1 · Código 1'}])
    result = restore_decisions({'proposals': [new, image]}, [old])
    assert new['status'] == 'confirmed' and new['reviewedRevision'] == 3
    assert new['previousFactIds'] == ['old']
    assert image['status'] == 'proposed' and image['supportStatus'] == 'needs_review'
    assert image['coveredByFactIds'] == ['new'] and not groups_of(result['proposals'])
    assert old['id'] == 'old'


def test_decisions_never_cross_scopes_or_nominal_physical_claims():
    old = fact('old', 'Pieza · largo', '75 mm', claimType='nominal', status='confirmed', confirmedValue='75 mm')
    physical = fact('actual', 'Pieza · largo', '75 mm')
    variant = fact('variant', 'Pieza · largo', '75 mm', claimType='nominal', scope='variant:s:variants[1]')
    restore_decisions({'proposals': [physical, variant]}, [old])
    assert physical['status'] == variant['status'] == 'proposed'


def test_migrated_saved_nominal_field_does_not_need_another_question_or_write():
    p = fact('p', 'Niveles de la torre', '18 niveles', claimType='nominal')
    product = {'revision': 3, 'customFields': [{'id': 'legacy-id', 'name': 'Número de niveles · diseño nominal',
                                             'value': '18 niveles', 'isConfirmed': True}]}
    original = deepcopy(product)
    assert already_current([p], product)
    assert p['status'] == 'confirmed' and p['confirmationOrigin'] == 'existing_product'
    assert product == original


def test_final_basic_corpus_retains_twelve_decisions_and_removes_identity_alias_questions():
    path = Path('/data12-corpus/corpus.json')
    if not path.exists():
        pytest.skip('Corpus final DATA12 no montado.')
    data = json.loads(path.read_text())
    before = deepcopy(data['product'])
    result = consolidate_proposals(data['proposals'], data['sources'], data['fragments'], data['product'])
    restore_decisions(result, data['facts']['proposals'], data['product'])
    confirmed = [p for p in result['proposals'] if p['status'] == 'confirmed']
    assert len(confirmed) == 12
    assert sorted(p['confirmedValue'] for p in confirmed) == sorted(p['confirmedValue'] for p in data['facts']['proposals'] if p['status'] == 'confirmed')
    assert data['product'] == before
    pending = [group[0]['canonicalField'] for group in groups_of(result['proposals'])]
    assert not set(pending) & {'custom:ean_gtin_13', 'custom:pais_fabricacion', 'custom:edad_minima'}
    assert 'name' not in pending  # El título escogido por el dueño prevalece sobre nombres documentales.
    for field in ('custom:niveles_torre', 'custom:parejas_frases', 'custom:alternancia_niveles', 'custom:dimensiones_guia'):
        supported = [p for p in result['proposals'] if p['canonicalField'] == field and p['supportStatus'] == 'supported']
        assert supported and all(p['claimType'] == 'nominal' for p in supported)
    assert all(p['evidence'] for p in result['proposals'] if p['supportStatus'] == 'supported')
    assert all(not p['reviewable'] for p in result['proposals'] if p['supportStatus'] == 'unsupported')
    # Parámetros de escenas son datos de producción, no nuevas preguntas del producto.
    render = [p for p in result['proposals'] if p['canonicalField'] == 'custom:motor_render' and p['supportStatus'] == 'supported']
    assert render and all(p['channel'] == 'production' and not p['reviewable'] for p in render)
