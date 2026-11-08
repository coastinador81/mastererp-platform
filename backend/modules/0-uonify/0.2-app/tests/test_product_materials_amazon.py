"""Las fuentes completan requisitos reales; los datos internos no crean preguntas."""
from copy import deepcopy
import pytest
from app.amazon_catalog import MARKETPLACE
from app.product_materials_amazon import infer_attributes
from app.product_requirements_fields import evaluate
from test_product_requirements import value, requirement_env
from test_product_materials_review import fact


def job(*facts, **extra):
    return {'id': 'analysis', 'status': 'ready', 'facts': {'version': 1, 'proposals': list(facts)}, **extra}


def schema(**properties):
    return {'type': 'object', 'properties': properties, 'required': list(properties)}


def test_supported_sources_fill_required_fields_preserving_evidence_and_originals():
    source = job(fact('material', 'custom:material', 'Material', 'Madera'))
    before = deepcopy(source)
    rules = schema(material=value(enum=['wood', 'plastic'], enumNames=['Madera', 'Plástico']))
    attrs, evidence, applied = infer_attributes({}, rules, MARKETPLACE, source)
    assert applied == {'material'} and attrs['material'][0]['value'] == 'wood'
    assert evaluate(rules, attrs, MARKETPLACE)['valid']
    proof = next(iter(evidence.values()))
    assert proof['humanConfirmed'] is False and proof['origin'] == 'documentary_inferred'
    assert proof['sources'][0]['id'] == 'material' and proof['sources'][0]['evidence']
    assert source == before


def test_optional_and_internal_design_facts_never_become_attributes_or_questions():
    rules = {'type': 'object', 'properties': {'material': value(), 'number_of_pieces': value('integer')}, 'required': ['material']}
    source = job(fact('material', 'custom:material', 'Material', 'Madera'),
                 fact('count', 'custom:numero_piezas', 'Número de piezas', '54'),
                 fact('service', 'custom:bloques_por_servicio', 'Bloques por servicio', '6 unidades', claimType='nominal'))
    attrs, _, applied = infer_attributes({}, rules, MARKETPLACE, source)
    assert applied == {'material'} and set(attrs) == {'material'}
    assert evaluate(rules, attrs, MARKETPLACE)['fields'] == []


@pytest.mark.parametrize('extra', [dict(supportStatus='needs_review'), dict(supportStatus='unsupported'),
    dict(claimType='visual_observation'), dict(claimType='nominal'), dict(channel='reference'),
    dict(scope='variant:one'), dict(status='rejected'), dict(evidence=[])])
def test_unreliable_or_wrong_scope_data_stays_internal(extra):
    source = job(fact('material', 'custom:material', 'Material', 'Madera', **extra))
    attrs, proof, applied = infer_attributes({}, schema(material=value()), MARKETPLACE, source)
    assert attrs == proof == {} and applied == set()


def test_conflicting_sources_are_not_resolved_by_majority_or_enum_validity():
    rules = schema(material=value(enum=['wood'], enumNames=['Madera']))
    source = job(fact('wood', 'custom:material', 'Material', 'Madera', sourceProposalIds=['a', 'b', 'c']),
                 fact('plastic', 'custom:material', 'Material', 'Plástico'))
    attrs, _, applied = infer_attributes({}, rules, MARKETPLACE, source)
    assert applied == set() and attrs == {}


def test_current_confirmed_product_wins_without_overwriting_historical_decisions():
    product = {'customFields': [{'id': 'manual', 'name': 'Material principal', 'value': 'Plástico', 'isConfirmed': True}]}
    source = job(fact('wood', 'custom:material', 'Material', 'Madera'))
    attrs, _, _ = infer_attributes(product, schema(material=value(enum=['wood', 'plastic'], enumNames=['Madera', 'Plástico'])), MARKETPLACE, source)
    assert attrs['material'][0]['value'] == 'plastic'
    assert source['facts']['proposals'][0]['status'] == 'proposed'
    assert product['customFields'][0]['value'] == 'Plástico'


def test_existing_amazon_values_and_foreign_market_values_are_preserved():
    product = {'amazonAttributes': {'material': [{'value': 'INVALID', 'marketplace_id': MARKETPLACE},
                                               {'value': 'holz', 'marketplace_id': 'A1PA6795UKMFR9'}]}}
    attrs, _, applied = infer_attributes(product, schema(material=value(enum=['wood'], enumNames=['Madera'])),
                                         MARKETPLACE, job(fact('wood', 'custom:material', 'Material', 'Madera')))
    assert attrs == product['amazonAttributes'] and not applied


def test_ean_age_and_country_use_typed_values_and_schema_labels():
    rules = schema(externally_assigned_product_identifier={'type': 'array', 'minItems': 1, 'items': {
        'type': 'object', 'required': ['value', 'type'], 'properties': {'value': {'type': 'string', 'pattern': '^\\d{13}$'},
        'type': {'type': 'string', 'enum': ['ean'], 'enumNames': ['EAN']}}}},
        manufacturer_minimum_age=value('integer', title='Edad mínima en meses'),
        country_of_origin=value(enum=['CN', 'ES'], enumNames=['China', 'España']))
    source = job(fact('ean', 'custom:ean_gtin_13', 'EAN / GTIN-13', '8435833200006'),
                 fact('age', 'custom:edad_minima', 'Edad mínima', '3 años'),
                 fact('country', 'custom:pais_fabricacion', 'País de fabricación', 'China'))
    attrs, _, applied = infer_attributes({}, rules, MARKETPLACE, source)
    assert len(applied) == 3 and evaluate(rules, attrs, MARKETPLACE)['valid']
    assert attrs['manufacturer_minimum_age'][0]['value'] == 36
    assert attrs['country_of_origin'][0]['value'] == 'CN'


def test_invalid_ean_and_ambiguous_age_are_not_guessed():
    rules = schema(externally_assigned_product_identifier=value(), manufacturer_minimum_age=value('integer', title='Edad mínima en meses'))
    source = job(fact('ean', 'custom:ean_gtin_13', 'EAN', '8435833200007'),
                 fact('age', 'custom:edad_minima', 'Edad mínima', '3'))
    assert infer_attributes({}, rules, MARKETPLACE, source)[0] == {}


def test_conditionally_required_attribute_appears_and_is_filled_when_documented():
    rules = schema(material=value(enum=['wood', 'plastic'], enumNames=['Madera', 'Plástico']))
    rules['properties']['manufacturer'] = value()
    rules['allOf'] = [{'if': {'required': ['material'], 'properties': {'material': {'contains': {
        'properties': {'value': {'const': 'wood'}}, 'required': ['value']}}}}, 'then': {'required': ['manufacturer']}}]
    source = job(fact('material', 'custom:material', 'Material', 'Madera'),
                 fact('maker', 'custom:fabricante', 'Fabricante', 'Empresa LLC'))
    attrs, _, applied = infer_attributes({}, rules, MARKETPLACE, source)
    assert applied == {'material', 'manufacturer'} and evaluate(rules, attrs, MARKETPLACE)['valid']


def test_new_conditional_format_invalidates_inference():
    rules = schema(model_name=value())
    rules['allOf'] = [{'if': {'required': ['model_name']}, 'then': {'properties': {'model_name': value(pattern='^B[A-Z]+$')}}}]
    assert infer_attributes({}, rules, MARKETPLACE, job(fact('model', 'custom:modelo', 'Modelo', '123')))[0] == {}


@pytest.mark.parametrize('extra', [{'status': 'paused'}, {'status': 'error'}, {'operation': 'repair_evidence'}, {'pauseReason': 'source_changed'}])
def test_incomplete_or_changed_reading_cannot_autofill(extra):
    source = job(fact('material', 'custom:material', 'Material', 'Madera'), **extra)
    assert infer_attributes({}, schema(material=value()), MARKETPLACE, source)[0] == {}


def test_second_preparation_is_idempotent():
    rules = schema(material=value())
    source = job(fact('material', 'custom:material', 'Material', 'Madera'))
    attrs, proof, _ = infer_attributes({}, rules, MARKETPLACE, source)
    result = infer_attributes({'amazonAttributes': attrs, 'amazonMaterialEvidence': proof}, rules, MARKETPLACE, source)
    assert result == (attrs, proof, set())


def test_documented_warning_is_not_a_certificate_and_can_complete_needed_text():
    source = job(fact('warning', 'custom:advertencia_seguridad', 'Advertencias y peligro',
                      'Piezas pequeñas. Peligro de asfixia', channel='safety'))
    attrs, _, _ = infer_attributes({}, schema(safety_warning=value()), MARKETPLACE, source)
    assert attrs['safety_warning'][0]['value'] == 'Piezas pequeñas. Peligro de asfixia'
    assert 'certification' not in attrs


def test_measured_dimensions_with_explicit_unit_can_be_mapped_but_nominal_cannot():
    dim = {'type': 'object', 'required': ['value', 'unit'], 'properties': {
        'value': {'type': 'number', 'title': 'Ancho Paquete', 'minimum': 0},
        'unit': {'type': 'string', 'enum': ['millimeters', 'centimeters'], 'enumNames': ['Milímetros', 'Centímetros']}}}
    rules = schema(item_package_dimensions={'type': 'array', 'items': {
        'type': 'object', 'required': ['width'], 'properties': {'width': dim}}})
    source = job(fact('width', 'custom:ancho_paquete', 'Ancho del paquete', '17.4 cm'))
    attrs, _, _ = infer_attributes({}, rules, MARKETPLACE, source)
    assert attrs['item_package_dimensions'][0]['width'] == {'value': 17.4, 'unit': 'centimeters'}
    source['facts']['proposals'][0]['claimType'] = 'nominal'
    assert infer_attributes({}, rules, MARKETPLACE, source)[0] == {}


def test_confirmed_nominal_count_is_a_count_and_never_becomes_a_measurement():
    product = {'customFields': [{'id': 'n', 'name': 'Número de piezas · diseño nominal',
                               'value': '54', 'isConfirmed': True}]}
    rules = schema(number_of_pieces=value('integer'))
    assert infer_attributes(product, rules, MARKETPLACE)[0]['number_of_pieces'][0]['value'] == 54


def test_chat_autofills_only_needed_evidence_and_does_not_reconfirm_fact(requirement_env):
    from uuid import uuid4
    from test_product_materials_guide import Materials
    from test_product_requirements import configure
    client, db, service, _, product, _ = requirement_env
    configured = configure(client, product)
    material_service = Materials()
    material_service.job = job(fact('battery', 'custom:battery', 'Battery', 'No'),
                              fact('material', 'custom:material', 'Material', 'Madera'),
                              fact('internal', 'custom:bloques_por_servicio', 'Bloques por servicio', '6 unidades', claimType='nominal'))
    material_service.job['id'] = str(uuid4())
    material_service.job['proposals'] = []
    material_service.job['sources'] = []
    client.app.state.materials.get = material_service.get
    before = deepcopy(material_service.job)
    response = client.post('/api/uony/messages', json={'requestId': str(uuid4()), 'threadId': 'amazon-data',
        'text': 'Continúa con mis datos', 'materialAction': {'action': 'review', 'sku': 'BASIC', 'analysisId': before['id']}})
    assert response.status_code == 200, response.text
    assert response.json()['conversationForm'] is None
    after = client.get('/api/products/BASIC/amazon-requirements').json()
    assert after['evaluation']['state'] == 'locally_valid'
    assert after['product']['amazonAttributes']['battery'][0]['value'] is False
    assert after['product']['amazonAttributes']['material'][0]['value'] == 'wood'
    assert after['product']['name'] == product['name'] and after['product']['brand'] == product['brand']
    assert material_service.job == before
    assert all(item['humanConfirmed'] is False for item in after['product']['amazonMaterialEvidence'].values())
    revision = after['product']['revision']
    assert client.get('/api/products/BASIC/amazon-requirements').json()['product']['revision'] == revision
    response = client.post('/api/uony/messages', json={'requestId': str(uuid4()), 'threadId': 'amazon-data',
        'text': 'Continuar', 'materialAction': {'action': 'review', 'sku': 'BASIC', 'analysisId': before['id']}})
    assert response.status_code == 200
    assert client.get('/api/products/BASIC/amazon-requirements').json()['product']['revision'] == revision


def test_stale_schema_prevents_any_automatic_write(requirement_env):
    from test_product_requirements import configure
    client, db, service, _, product, _ = requirement_env
    original = configure(client, product)['product']
    with db.connect() as c:
        c.execute("UPDATE product_requirement_schemas SET fetched_at=now()-interval '25 hours'")
        user = c.execute('SELECT * FROM users').fetchone()
        result = service.prepare_for(c, user, 'BASIC', job(fact('material', 'custom:material', 'Material', 'Madera')))
    assert result['product'] == original and result['evaluation']['state'] == 'stale'


def test_original_game_language_does_not_claim_manual_translations():
    node = {'type': 'array', 'items': {'type': 'object', 'required': ['type', 'value'],
        'properties': {'type': {'type': 'string', 'enum': ['original', 'manual']},
                       'value': {'type': 'string', 'enum': ['spanish', 'english']}}}}
    product = {'customFields': [{'id': 'language', 'name': 'Idioma de las frases · diseño nominal',
                               'value': 'Español', 'isConfirmed': True}]}
    attrs, _, _ = infer_attributes(product, schema(language=node), MARKETPLACE)
    assert attrs['language'] == [{'type': 'original', 'value': 'spanish'}]
    assert not any(row['type'] == 'manual' for row in attrs['language'])


def test_design_or_test_words_in_a_real_name_do_not_make_documented_data_uncertain():
    product = {'name': 'Mesa de diseño en madera', 'customFields': [
        {'id': 'manufacturer', 'name': 'Fabricante', 'value': 'Ensayo LLC', 'isConfirmed': True}]}
    attrs, _, _ = infer_attributes(product, schema(item_name=value(), manufacturer=value()), MARKETPLACE)
    assert attrs['item_name'][0]['value'] == 'Mesa de diseño en madera'
    assert attrs['manufacturer'][0]['value'] == 'Ensayo LLC'


@pytest.mark.parametrize('text,expected', [
    ('No apto para menores de 3 años. Piezas pequeñas. Peligro de asfixia.', True),
    ('No contiene piezas pequeñas. No hay peligro de asfixia.', False)])
def test_warning_negation_is_local_not_the_age_restriction(text, expected):
    source = job(fact('warning', 'custom:advertencia_seguridad', 'Advertencias', text, channel='safety'))
    rules = schema(eu_toys_safety_directive_warning=value(enum=['choking_hazard_small_parts']))
    attrs, _, _ = infer_attributes({}, rules, MARKETPLACE, source)
    assert bool(attrs) is expected


def test_gpsr_contacts_are_mapped_only_to_their_respective_required_roles():
    rules = schema(gpsr_manufacturer_reference={'type': 'array', 'minItems': 1, 'items': {
        'type': 'object', 'required': [], 'properties': {
            'gpsr_manufacturer_email_address': {'type': 'string', 'title': 'Correo del fabricante'}}}},
        dsa_responsible_party_address=value())
    source = job(fact('maker', 'custom:fabricante_correo', 'Fabricante · correo', 'maker@example.test'),
                 fact('eu', 'custom:responsable_ue_correo', 'Responsable UE · correo', 'responsible@example.test'))
    attrs, _, applied = infer_attributes({}, rules, MARKETPLACE, source)
    assert applied == set(rules['required'])
    assert attrs['gpsr_manufacturer_reference'][0]['gpsr_manufacturer_email_address'] == 'maker@example.test'
    assert attrs['dsa_responsible_party_address'][0]['value'] == 'responsible@example.test'
    rules['required'] = []
    assert infer_attributes({}, rules, MARKETPLACE, source)[0] == {}


def test_missing_unit_is_not_combined_with_a_different_already_stored_number():
    node = {'type': 'array', 'items': {'type': 'object', 'required': ['value', 'unit'], 'properties': {
        'value': {'type': 'number'}, 'unit': {'type': 'string', 'enum': ['grams', 'kilograms']}}}}
    product = {'amazonAttributes': {'item_weight': [{'value': 999}]}}
    source = job(fact('weight', 'custom:peso_producto', 'Peso del producto', '1 kg'))
    assert infer_attributes(product, schema(item_weight=node), MARKETPLACE, source)[0] == product['amazonAttributes']
