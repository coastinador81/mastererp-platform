"""Bounded semantic context retains original records and retrieval coverage."""
from copy import deepcopy
from app.product_reasoning_context import build_context, MAX_TEXT, MAX_TEXT_UNITS
from test_product_reasoning import fixture


def test_json_siblings_share_one_complete_record_and_all_fact_citations():
    data = fixture(pictures=0, texts=[
        {'locator': '$.fields[0].label', 'text': 'Ancho'},
        {'locator': '$.fields[0].value', 'text': '20'},
        {'locator': '$.fields[0].unit', 'text': 'cm'},
        {'locator': '$.fields[0].note', 'text': 'Diseño nominal; no medido físicamente'},
    ])
    data[2]['facts']['proposals'] = [{'id': 'fact-' + leaf, 'field': 'custom:ancho',
        'scope': 'product', 'channel': 'product', 'value': '20', 'evidence': [
            {'sourceId': 's1', 'locator': '$.fields[0].' + leaf}]} for leaf in ('label', 'value')]
    before = deepcopy(data)
    result = build_context(*data)
    units = [entry for entry in result['evidence'] if entry['kind'] == 'text']
    assert len(units) == 1
    assert units[0]['locator'].endswith('.value')
    assert 'no medido físicamente' in units[0]['text'] and 'cm' in units[0]['text']
    assert len(units[0]['_aliases']) == 4
    assert all(fact['evidenceRefs'] == [units[0]['id']] for fact in result['facts'])
    assert data == before


def test_duplicate_originals_keep_their_citation_aliases_without_repeating_text():
    data = fixture(pictures=0)
    data[3][0]['sha256'] = 'identical-original'
    data[3].append({**data[3][0], 'id': 's2', 'name': 'copia-manual.json'})
    data[4].append({**data[4][0], 'id': 'f2', 'source_id': 's2'})
    data[2]['facts']['proposals'] = [{'id': 'f', 'field': 'custom:funcion', 'channel': 'product',
        'evidence': [{'sourceId': 's2', 'locator': '$.operation'}]}]
    result = build_context(*data)
    originals = [entry for entry in result['evidence'] if entry['kind'] == 'text']
    assert len(originals) == 1
    assert {alias['sourceId'] for alias in originals[0]['_aliases']} == {'s1', 's2'}
    assert result['facts'][0]['evidenceRefs'] == [originals[0]['id']]
    assert result['coverage']['sourceCount'] == 2


def test_bounded_units_and_characters_keep_every_omitted_unit_retrievable():
    data = fixture(pictures=0, texts=[{'locator': f'Paragraph {i:04}',
        'text': 'Contenido original del manual. ' * 10 + str(i)} for i in range(250)])
    before = deepcopy(data)
    first = build_context(*data)
    selected = {entry['id'] for entry in first['evidence'] if entry['kind'] == 'text'}
    omitted = {entry['id'] for entry in first['coverage']['omittedUnits']}
    assert len(selected) <= MAX_TEXT_UNITS
    assert first['coverage']['textCharacters'] <= MAX_TEXT
    assert len(selected | omitted) == 250 and not selected & omitted
    requested = first['coverage']['omittedUnits'][-1]['id']
    following = build_context(*data, requested_evidence=[requested])
    assert requested in {entry['id'] for entry in following['evidence']}
    assert len({entry['id'] for entry in following['evidence'] if entry['kind'] == 'text'} |
               {entry['id'] for entry in following['coverage']['omittedUnits']}) == 250
    assert following['fingerprint'] != first['fingerprint']
    assert data == before


def test_confirmed_values_survive_a_full_text_budget():
    data = fixture(pictures=0, texts=[{'locator': f'Row {i}', 'text': 'x' * 300} for i in range(150)])
    data[0]['customFields'] = [{'id': 'kept', 'name': 'Material', 'value': 'Madera', 'isConfirmed': True}]
    result = build_context(*data)
    assert result['protected']['customFields'] == data[0]['customFields']
    assert any(entry['kind'] == 'user_confirmed' and entry['field']['id'] == 'kept' for entry in result['evidence'])
