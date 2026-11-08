from copy import deepcopy
from app.product_materials_resolution import project_resolution, fragment_problem
from app.product_materials_analyzer import validate_output, response_schema
from app.product_materials_citations import referenced_sources


def fragment(**changes):
    return {'id': 'f', 'source_id': 's', 'state': 'partial', 'payload': {},
            'result': {'observations': {'s': 'Examinado'}, 'discardedProposalCount': 1,
                       'warnings': ['1 propuestas requieren comprobar su evidencia; se conserva el fragmento para revisión.'],
                       'candidates': [], 'rejections': [{'id': 'bad', 'code': 'invalid_candidate'}]}, **changes}


def test_recorded_discard_is_closed_not_perpetual_technical_incident():
    f = fragment()
    assert fragment_problem(f) is None
    source = {'id': 's', 'name': 'Ficha', 'readComplete': True, 'readingCoverage': {'complete': True}}
    resolution = project_resolution([source], [f])
    assert resolution['processedSources'] == resolution['completeSources'] == 1
    assert resolution['technicalPendingCount'] == 0
    assert resolution['sourceSummaries']['s']['historicalDiscardCount'] == 1


def test_unrecoverable_legacy_discard_requires_directed_repair_not_fake_success():
    f = fragment()
    del f['result']['candidates']
    r = project_resolution([], [f])
    assert r['technicalPendingCount'] == 1 and r['historicalRejectionCount'] == 1
    assert r['issues'][0]['action'] == 'repair_evidence'
    f['state'], f['repairReplacedBy'] = 'superseded', 'new'
    new = fragment(id='new', state='done')
    r = project_resolution([], [f, new])
    assert r['technicalPendingCount'] == 0 and r['resolvedCount'] == 1
    assert r['historicalRejectionCount'] == 1  # El historial no se borra.


def test_recorded_citation_recovered_in_facts_does_not_reopen_model_call():
    f = fragment()
    f['result']['rejections'] = [{'id': 'p', 'code': 'citation_not_found'}]
    assert fragment_problem(f)
    facts = {'proposals': [{'sourceProposalIds': ['p'], 'supportStatus': 'supported', 'evidence': [{'fragmentId': 'other'}]}]}
    assert fragment_problem(f, facts)  # Una región ajena no repara esta cita.
    facts['proposals'][0]['evidence'] = [{'fragmentId': 'f'}]
    assert fragment_problem(f, facts) is None


def test_archive_attempted_does_not_equal_complete_and_bound_repair():
    source = {'id': 's', 'name': 'zip', 'readComplete': True, 'readingCoverage': {'complete': False,
        'archiveEntries': [{'path': 'x.ai', 'status': 'uninterpreted', 'reason': 'Convertir'}]}}
    r = project_resolution([source], [])
    assert r['processedSources'] == 1 and r['completeSources'] == 0
    assert r['technicalPendingCount'] == 1
    f = fragment(payload={'repairRound': 2}, result={'coverageLimited': True})
    assert project_resolution([], [f])['issues'][0]['action'] == 'replace_source'


def test_closed_evidence_refs_resolve_server_side_without_cross_region_or_source():
    sources = [{'id': 's', 'name': 'Pack', 'image': True, 'visualLocator': 'Página 2 · región 3',
                'segments': [{'locator': 'Celda A1', 'text': 'Marca: UONIFY'}]},
               {'id': 'other', 'name': 'Otra ficha', 'segments': [{'locator': 'Celda A1', 'text': 'Marca: OTRA'}]}]
    referenced = referenced_sources(sources)
    assert referenced[0]['segments'][0]['evidenceRef'] == 'e0'
    assert referenced[0]['visualEvidenceRef'] == 'e1'
    assert 'evidenceRef' not in sources[0]['segments'][0]
    schema = response_schema(sources)
    assert schema['properties']['proposals']['items']['properties']['evidence']['items']['properties']['evidenceRef']['enum'] == ['e0', 'e1', 'e2']
    raw = {'field': 'brand', 'label': 'Marca', 'value': 'UONIFY',
           'evidence': [{'evidenceRef': 'e0', 'sourceId': 'other', 'locator': 'inventado', 'excerpt': 'UONIFY'}]}
    result = validate_output({'proposals': [raw]}, sources)
    assert result['proposals'][0]['evidence'] == [{'sourceId': 's', 'locator': 'Celda A1', 'excerpt': 'UONIFY'}]
    invalid = deepcopy(raw)
    invalid['evidence'][0]['evidenceRef'] = 'e99'
    assert not validate_output({'proposals': [invalid]}, sources)['proposals']
    invalid['evidence'][0]['evidenceRef'] = 'e2'
    assert not validate_output({'proposals': [invalid]}, sources)['proposals']


def test_repair_chain_counts_one_closed_original_only_after_all_parts_resolve():
    root = fragment(state='superseded', repairReplacedBy='retry1')
    retry = fragment(id='retry1', payload={'repairOf': 'f', 'repairRound': 1}, result={'coverageLimited': True})
    assert project_resolution([], [root, retry])['resolvedCount'] == 0
    retry.update(state='superseded', repairReplacedBy='retry2')
    second = fragment(id='retry2', state='split', payload={'repairOf': 'retry1', 'repairRound': 2})
    a = fragment(id='a', state='done', payload={'parentId': 'retry2'})
    b = fragment(id='b', payload={'parentId': 'retry2'}, result={'coverageLimited': True})
    assert project_resolution([], [root, retry, second, a, b])['resolvedCount'] == 0
    b['result'] = deepcopy(a['result'])
    result = project_resolution([], [root, retry, second, a, b])
    assert result['resolvedCount'] == 1 and result['technicalPendingCount'] == 0


def test_resource_awaiting_replacement_is_not_a_question_or_a_closed_review():
    fact = {'id': 'lot', 'field': 'custom:lot', 'label': 'Lote', 'value': 'wrong',
            'status': 'proposed', 'reviewable': True, 'supportStatus': 'needs_review',
            'observationIssue': {'sourceId': 'box'}, 'resolution': {'status': 'awaiting_source'}}
    result = project_resolution([], [], {'proposals': [fact]})
    assert result['clientPendingCount'] == result['technicalPendingCount'] == result['resolvedCount'] == 0
    assert result['sourcePendingCount'] == 1
    issue = result['issues'][0]
    assert issue['status'] == 'awaiting_source' and issue['action'] == 'replace_source' and issue['sourceId'] == 'box'


def test_known_reference_with_invented_quote_is_a_discard_not_a_reading_retry():
    sources = [{'id': 'ce', 'name': 'CE.ai', 'segments': [
        {'locator': 'AI · Capas y trazados', 'text': 'Símbolo CE: 9 trazados, 2 visibles.'}]}]
    proposal = {'field': 'brand', 'label': 'Marca', 'value': 'UONIFY', 'evidence': [
        {'evidenceRef': 'e0', 'excerpt': 'Declarado por cliente en producto objetivo'}]}
    output = validate_output({'proposals': [proposal], 'observations': [{'sourceId': 'ce', 'summary': 'Símbolo CE'}]}, sources)
    assert output['candidates'] and not output['proposals']
    assert output['rejections'][0]['code'] == 'quote_not_found'
    f = fragment(source_id='ce', result=output)
    assert fragment_problem(f) is None
    proposal['evidence'].append({'evidenceRef': 'e99', 'excerpt': 'UONIFY'})
    invalid = validate_output({'proposals': [proposal]}, sources)
    assert invalid['rejections'][0]['code'] == 'citation_not_found'
