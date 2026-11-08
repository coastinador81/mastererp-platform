import json
from pathlib import Path
import pytest
from app.product_materials_facts import consolidate_proposals
from app.product_materials_values import normalize_value


def corpus(rows, source='spec', name='ficha.json', version='v1', **metadata):
    return ([{'id': source, 'name': name, 'version': version, **metadata}],
            [{'id': 'fragment-' + source, 'source_id': source, 'version': version,
              'payload': {'id': source, 'segments': [{'locator': key, 'text': value} for key, value in rows]}}])


def proposal(label, value, locator, excerpt=None, source='spec', identifier='p1', field='custom:any', **extra):
    return {'id': identifier, 'field': field, 'label': label, 'value': value, 'status': 'proposed',
            'evidence': [{'sourceId': source, 'locator': locator, 'excerpt': excerpt if excerpt is not None else value}], **extra}


def reconcile(proposals, rows, **kwargs):
    sources, fragments = corpus(rows, **kwargs)
    return consolidate_proposals(proposals, sources, fragments)


def supported(result):
    return [fact for fact in result['proposals'] if fact['supportStatus'] == 'supported']


def test_aliases_values_and_evidence_merge_without_discarding_originals():
    result = reconcile([
        proposal('EAN', '8435833200006', '$.ean', identifier='one'),
        proposal('Código EAN-13', '8 435833 200006 (declarado por cliente)', '$.ean', '8435833200006', identifier='two'),
        proposal('EAN / GTIN', '8435833200006 (Confirmado por el dueño)', '$.ean', '8435833200006', identifier='three')],
        [('$.ean', '"8435833200006"')])
    facts = supported(result)
    assert len(facts) == 1
    fact = facts[0]
    assert fact['canonicalField'] == 'custom:ean_gtin_13'
    assert len(fact['originalValues']) == 3
    assert fact['sourceProposalIds'] == ['one', 'three', 'two']
    assert len(fact['evidence']) == 1
    assert fact['evidence'][0]['sourceVersion'] == 'v1'
    assert fact['evidence'][0]['fragmentId'] == 'fragment-spec'
    assert fact['status'] == 'proposed'


@pytest.mark.parametrize('first,second', [('3 años', '36 meses'), ('A partir de 3 años', '3+')])
def test_equivalent_age_values_merge(first, second):
    result = reconcile([proposal('Edad mínima prevista', first, '$.edad', '3 años', identifier='one'),
                        proposal('Edad recomendada', second, '$.edad', '3 años', identifier='two')],
                       [('$.edad', '"3 años"')])
    assert len(supported(result)) == 1
    assert supported(result)[0]['normalizedValue'] == '36'
    assert len(supported(result)[0]['sourceProposalIds']) == 2


def test_units_equivalent_but_nominal_and_physical_claims_are_separate():
    result = reconcile([
        proposal('Pieza · largo', '7.5 cm (dimensión nominal)', '$.pieza_largo', '75 mm', identifier='one'),
        proposal('Longitud nominal de pieza', '75 mm (Diseño 3D)', '$.pieza_largo', '75 mm', identifier='two'),
        proposal('Pieza · largo', '75 mm', '$.pieza_largo', '75 mm', identifier='physical')],
        [('$.pieza_largo', '"75 mm"')])
    facts = supported(result)
    assert len(facts) == 2
    assert {f['claimType'] for f in facts} == {'declared', 'nominal'}
    assert all(f['normalizedValue'] == '75' and f['unit'] == 'mm' for f in facts)


def test_conflict_is_not_decided_by_copies_or_order():
    sources_a, fragments_a = corpus([('$.material', '"Madera"')], source='a')
    sources_b, fragments_b = corpus([('$.material', '"Plástico"')], source='b')
    proposals = [proposal('Material principal', 'Madera', '$.material', source='a', identifier=str(i)) for i in range(8)]
    proposals += [proposal('Material', 'Plástico', '$.material', source='b', identifier='b')]
    result = consolidate_proposals(proposals, sources_a + sources_b, fragments_a + fragments_b)
    reverse = consolidate_proposals(list(reversed(proposals)), sources_b + sources_a, fragments_b + fragments_a)
    assert len(supported(result)) == 2
    assert all(f['conflict'] for f in result['proposals'])
    assert len({f['conflictGroup'] for f in result['proposals']}) == 1
    assert {f['id'] for f in result['proposals']} == {f['id'] for f in reverse['proposals']}
    assert all(f['status'] == 'proposed' for f in result['proposals'])


def test_variants_are_separate_and_not_a_product_conflict():
    result = reconcile([proposal('Material', 'Madera', '$.variants[0].material', identifier='a'),
                        proposal('Material', 'Plástico', '$.variants[1].material', identifier='b')],
                       [('$.variants[0].material', '"Madera"'), ('$.variants[1].material', '"Plástico"')])
    assert len(supported(result)) == 2
    assert not any(f['conflict'] for f in result['proposals'])
    assert len({f['scope'] for f in result['proposals']}) == 2


def test_literal_quote_cannot_support_unrelated_value_or_email_as_brand():
    result = reconcile([proposal('Marca', 'UONIFY', '$.email', 'contact@uonify.com', field='brand')],
                       [('$.email', '"contact@uonify.com"')])
    assert not supported(result)
    assert result['rejections'][0]['code'] == 'value_not_supported'
    assert not result['proposals'][0]['reviewable']


@pytest.mark.parametrize('text', ['No contiene madera', 'Sin madera', 'No es madera'])
def test_negated_material_is_not_a_positive_assertion(text):
    result = reconcile([proposal('Material', 'Madera', 'Página 1', text)], [('Página 1', 'Material: ' + text)], name='ficha.pdf')
    assert not supported(result)


def test_value_of_distributor_is_not_the_manufacturer():
    text = 'Fabricante: ACME. Distribuidor: ETHICS CLOUD & SECURITY SERVICES LLC'
    result = reconcile([proposal('Fabricante', 'ETHICS CLOUD & SECURITY SERVICES LLC', 'Página 1')],
                       [('Página 1', text)], name='ficha.pdf')
    assert not supported(result)
    assert any(r['code'] == 'attribute_not_supported' for r in result['rejections'])


def test_paged_manufacturer_label_and_next_line_support_relationship():
    value = 'ETHICS CLOUD & SECURITY SERVICES LLC'
    result = reconcile([proposal('Fabricante', value, 'Página 1')],
                       [('Página 1', 'Fabricante\n' + value + '\nPaís: China')], name='ficha.pdf')
    assert len(supported(result)) == 1


def test_json_attribute_value_relation_cannot_borrow_a_different_sibling():
    result = reconcile([proposal('Fabricante', 'ETHICS LLC', '$.distributor', 'ETHICS LLC')],
                       [('$.manufacturer', '"ACME"'), ('$.distributor', '"ETHICS LLC"')])
    assert not supported(result)


def test_json_record_joins_label_unit_and_value_across_original_fragments():
    sources, fragments = corpus([('$.fields[0].value', '3')])
    fragments += [{'id': 'other', 'source_id': 'spec', 'version': 'v1', 'payload': {'segments': [
        {'locator': '$.fields[0].label', 'text': '"Edad mínima prevista"'},
        {'locator': '$.fields[0].unit', 'text': '"años"'}]}}]
    result = consolidate_proposals([proposal('Edad mínima prevista', '3 años', '$.fields[0].value', '3')], sources, fragments)
    assert len(supported(result)) == 1
    assert supported(result)[0]['evidence'][0]['excerpt'] == '3'
    context_citations = supported(result)[0]['evidence'][0]['contextEvidence']
    assert {item['locator'] for item in context_citations} == {'$.fields[0].label', '$.fields[0].unit'}
    assert all(item['fragmentId'] == 'other' for item in context_citations)


@pytest.mark.parametrize('name,text', [('directrices-comision-europea.pdf', 'Material: plástico'),
                                       ('ficha.pdf', 'Ejemplo de producto competidor\nMaterial: plástico')])
def test_external_reference_never_becomes_a_commercial_fact(name, text):
    result = reconcile([proposal('Material', 'plástico', 'Página 1')], [('Página 1', text)], name=name)
    fact = result['proposals'][0]
    assert fact['channel'] == 'reference'
    assert fact['supportStatus'] == 'unsupported'
    assert not fact['reviewable']


def test_render_parameters_are_preserved_in_production_channel():
    result = reconcile([proposal('Resolución de render', '3000x2000', '$.render.resolution')],
                       [('$.render.resolution', '"3000x2000"')])
    fact = result['proposals'][0]
    assert fact['channel'] == 'production'
    assert not fact['reviewable']


def test_image_never_counts_as_documentary_evidence_and_missing_visual_is_rejected():
    sources = [{'id': 'photo', 'name': 'photo.png', 'version': 'v1', 'image': {}}]
    fragments = [{'id': 'img', 'source_id': 'photo', 'version': 'v1', 'payload': {'image': {'width': 100}}}]
    result = consolidate_proposals([proposal('Marca', 'UONIFY', 'Imagen', 'Logotipo UONIFY visible', source='photo', identifier='yes'),
                                    proposal('Material', 'Madera', 'Imagen', 'Se observa una caja azul', source='photo', identifier='no')], sources, fragments)
    assert not supported(result)
    assert next(f for f in result['proposals'] if f['canonicalField'] == 'brand')['supportStatus'] == 'needs_review'
    assert next(f for f in result['proposals'] if f['canonicalField'] == 'custom:material')['supportStatus'] == 'unsupported'


def test_failed_quote_is_recovered_from_same_source_and_rejection_remains_auditable():
    result = reconcile([proposal('Marca', 'UONIFY', '$.other', 'Basic Mini Bricks', field='brand')],
                       [('$.other', '"Basic Mini Bricks"'), ('$.brand', '"UONIFY"')])
    fact = supported(result)[0]
    assert fact['evidence'][0]['locator'] == '$.brand'
    assert fact['evidence'][0]['excerpt'] == '"UONIFY"'
    assert fact['evidence'][0]['recovered']
    assert result['rejections'][0]['recovered']


def test_stale_version_and_superseded_fragment_cannot_back_a_fact():
    sources, fragments = corpus([('$.material', '"Madera"')])
    fragments[0]['version'] = 'v0'
    result = consolidate_proposals([proposal('Material', 'Madera', '$.material')], sources, fragments)
    assert not supported(result)
    fragments[0]['version'] = 'v1'
    fragments[0]['state'] = 'superseded'
    result = consolidate_proposals([proposal('Material', 'Madera', '$.material')], sources, fragments)
    assert not supported(result)


def test_pending_value_and_certification_never_become_verified_facts():
    result = reconcile([proposal('Peso neto', 'Pendiente de pesar', '$.peso', identifier='pending'),
                        proposal('Certificación FSC', 'FSC', '$.certificacion_fsc', identifier='certificate')],
                       [('$.peso', '"Pendiente de pesar"'), ('$.certificacion_fsc', '"FSC"')])
    assert not supported(result)
    cert = next(f for f in result['proposals'] if f['channel'] == 'safety')
    assert cert['claimType'] == 'certified_claim'
    assert cert['supportStatus'] == 'needs_review'


def test_real_basic_mini_bricks_corpus_when_available():
    path = Path(__file__).resolve().parents[2] / 'artifacts/data11-20261014/corpus.json'
    if not path.exists():
        pytest.skip('El corpus del piloto es evidencia local, no una dependencia de CI.')
    data = json.loads(path.read_text())
    result = consolidate_proposals(data['proposals'], data['sources'], data['fragments'], data['product'])
    for field in ('custom:ean_gtin_13', 'custom:edad_minima', 'custom:material', 'custom:fabricante'):
        found = [f for f in supported(result) if f['canonicalField'] == field and f['claimType'] == 'declared']
        assert len(found) == 1
        assert len(found[0]['sourceProposalIds']) >= 2
    assert result['summary']['recoveredCitationCount'] > 0
    assert all(f['evidence'] for f in supported(result))
    assert all(e['supportStatus'] == 'supported' for f in supported(result) for e in f['evidence'])


def test_fractional_age_keeps_decimal_and_converts_exactly():
    assert normalize_value('custom:edad_minima', '3,5 años') == ('42', '42 meses', 'meses')
    assert normalize_value('custom:edad_minima', '3.5 years') == ('42', '42 meses', 'meses')


def test_duplicate_original_segments_have_stable_citation_ids_when_reordered():
    sources, fragments = corpus([('$.material', '"Madera"')])
    fragments += [{**fragments[0], 'id': 'split-child'}]
    proposal_rows = [proposal('Material', 'Madera', '$.material')]
    first = consolidate_proposals(proposal_rows, sources, fragments)
    second = consolidate_proposals(proposal_rows, sources, list(reversed(fragments)))
    assert first == second


def test_explicit_other_product_sku_is_not_attributed_to_target():
    sources, fragments = corpus([('$.product.sku', '"OTHER-123"'), ('$.product.material', '"Madera"')])
    result = consolidate_proposals([proposal('Material', 'Madera', '$.product.material')], sources, fragments, {'sku': 'TARGET'})
    fact = result['proposals'][0]
    assert fact['channel'] == 'reference'
    assert fact['scope'] == 'product:OTHER-123'
    assert not fact['reviewable']


def test_material_nominal_duplicate_is_retained_without_second_question():
    result = reconcile([proposal('Material', 'Madera', '$.material', identifier='declared'),
                        proposal('Material', 'Madera (diseño 3D)', '$.material', 'Madera', identifier='nominal')],
                       [('$.material', '"Madera"')])
    assert len(supported(result)) == 2
    assert next(f for f in result['proposals'] if f['claimType'] == 'declared')['reviewable']
    assert not next(f for f in result['proposals'] if f['claimType'] == 'nominal')['reviewable']


def test_source_nominal_status_cannot_be_removed_by_model():
    rows = [('$.fields[0].label', '"Material"'), ('$.fields[0].value', '"Madera"'), ('$.fields[0].status', '"Diseño 3D"')]
    result = reconcile([proposal('Material', 'Madera', '$.fields[0].value')], rows)
    assert supported(result)[0]['claimType'] == 'nominal'


def test_nominal_age_duplicates_do_not_repeat_declared_identity_question():
    result = reconcile([proposal('Edad mínima', '3 años', '$.edad', identifier='declared'),
                        proposal('Edad mínima', '3 años (diseño 3D)', '$.edad', '3 años', identifier='nominal')],
                       [('$.edad', '"3 años"')])
    assert len(supported(result)) == 2
    assert next(f for f in result['proposals'] if f['claimType'] == 'declared')['reviewable']
    assert not next(f for f in result['proposals'] if f['claimType'] == 'nominal')['reviewable']


def test_symbol_details_merge_without_promoting_subset_citations_to_longer_claim():
    label = 'Símbolos presentes en el arte'
    core = 'CE, 3+, pictograma 0–3 y Möbius'
    sources, fragments, proposals = [], [], []
    for i, value in enumerate((core, core + ' con instrucción papel/cartón',
                               core + ' con instrucción papel/cartón al contenedor azul en España')):
        source = 's' + str(i)
        item_sources, item_fragments = corpus([('Página 1', label + ': ' + value)], source=source, name='ficha.pdf')
        sources.extend(item_sources)
        fragments.extend(item_fragments)
        proposals.append(proposal(label, value, 'Página 1', source=source, identifier=source))
    result = consolidate_proposals(proposals, sources, fragments)
    assert len(supported(result)) == 1
    fact = supported(result)[0]
    assert fact['value'] == core
    assert len(fact['originalValues']) == 3
    assert len(fact['sourceProposalIds']) == 3
    assert len(fact['evidence']) == 3
    assert not fact['conflict']
    reverse = consolidate_proposals(list(reversed(proposals)), sources, fragments)
    assert reverse['proposals'][0]['id'] == fact['id']


@pytest.mark.parametrize('first,second', [
    ('CE y FSC', 'CE sin FSC'),
    ('CE y Möbius', 'CE, FSC y Möbius'),
    ('CE y Möbius con instrucción contenedor azul', 'CE y Möbius con instrucción contenedor verde'),
])
def test_incompatible_symbol_claims_remain_conflicts(first, second):
    label = 'Símbolos presentes en el arte'
    result = reconcile([proposal(label, first, '$.fields[0].value', identifier='a'),
                        proposal(label, second, '$.fields[1].value', identifier='b')],
                       [('$.fields[0].label', '"' + label + '"'), ('$.fields[0].value', '"' + first + '"'),
                        ('$.fields[1].label', '"' + label + '"'), ('$.fields[1].value', '"' + second + '"')])
    assert len(supported(result)) == 2
    assert result['summary']['conflictCount'] == 1
    assert all(f['conflict'] for f in result['proposals'])


def test_visual_inscriptions_scope_to_each_asset_but_identity_stays_product_wide():
    sources = [{'id': key, 'name': key + '.png', 'version': 'v1'} for key in ('a', 'b')]
    fragments = [{'id': key, 'source_id': key, 'version': 'v1',
                  'payload': {'image': {'width': 100}}} for key in ('a', 'b')]
    proposals = [proposal('Texto impreso superior', 'Todo bajo control.', 'Imagen', source='a', identifier='a'),
                 proposal('Texto impreso superior', 'Eso dije antes.', 'Imagen', source='b', identifier='b'),
                 proposal('Marca', 'UONIFY', 'Imagen', source='a', identifier='brand1'),
                 proposal('Marca', 'OTRA', 'Imagen', source='b', identifier='brand2')]
    result = consolidate_proposals(proposals, sources, fragments)
    texts = [f for f in result['proposals'] if f['canonicalField'] == 'custom:frase_superior']
    assert {f['scope'] for f in texts} == {'asset:a', 'asset:b'}
    assert not any(f['conflict'] for f in texts)
    brands = [f for f in result['proposals'] if f['canonicalField'] == 'brand']
    assert all(f['scope'] == 'product' and f['conflict'] for f in brands)


def test_different_inscriptions_on_same_asset_remain_a_conflict():
    sources = [{'id': 'a', 'name': 'a.png', 'version': 'v1'}]
    fragments = [{'id': 'a', 'source_id': 'a', 'version': 'v1', 'payload': {'image': {'width': 100}}}]
    result = consolidate_proposals([proposal('Texto impreso superior', 'Uno', 'Imagen', source='a', identifier='a'),
                                    proposal('Texto impreso superior', 'Dos', 'Imagen', source='a', identifier='b')],
                                   sources, fragments)
    assert result['summary']['conflictCount'] == 1
    assert all(f['conflict'] and f['scope'] == 'asset:a' for f in result['proposals'])
