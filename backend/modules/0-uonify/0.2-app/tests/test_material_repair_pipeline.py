"""Reparación completa con PostgreSQL y proveedores controlados, sin IA ni Drive reales."""
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4
from psycopg.types.json import Jsonb
from app.product_materials_analyzer import validate_output
from app.product_materials_control_consent import record_control_consent
from app.product_materials_controls import CALLS_PER_WINDOW, TOKENS_PER_WINDOW
from app.product_materials_facts import consolidate_proposals
from material_legacy_history import seed_previous_review
from conftest import client_for
from test_google_cloud import Cloud
from test_material_repair import legacy
from test_material_reader_upgrade import product_snapshot
from test_product_materials import FolderDrive
from material_control_copy import control_body


SEGMENTS = [{'locator': 'Página 1 · Marca', 'text': 'Marca: UONIFY'},
            {'locator': 'Página 1 · Material', 'text': 'Material: Madera'}]


class StoredDrive(FolderDrive):
    def __init__(self):
        super().__init__()
        self.checked = []

    def metadata(self, token, identifier):
        self.checked.append(identifier)
        return {'id': identifier, 'name': 'Packaging.pdf' if identifier == 'pack' else 'Ficha.json',
                'mimeType': 'application/pdf' if identifier == 'pack' else 'application/json',
                'capabilities': {'canDownload': True}}

    def content(self, *args, **kwargs):
        raise AssertionError('Reparar la evidencia no debe volver a descargar el original leído.')

    def files(self, *args, **kwargs):
        raise AssertionError('El descubrimiento del análisis ya estaba terminado.')


class RepairAnalyzer:
    def __init__(self, fail=False):
        self.fail, self.calls = fail, []

    def analyze(self, token, project, product, sources):
        source = sources[0]
        self.calls.append(deepcopy(source))
        if self.fail:
            # Candidato conservado con una referencia inválida: sigue siendo incidencia.
            proposals = [{'field': 'custom:lote', 'label': 'Lote', 'value': 'B-1',
                          'evidence': [{'evidenceRef': 'e99', 'excerpt': 'B-1'}]}]
        else:
            proposals = raw_proposals()
        output = validate_output({'observations': [{'sourceId': source['id'], 'summary': 'Parte comprobada.'}],
                                  'proposals': proposals}, sources)
        return {**output, 'usage': {'calls': 1, 'totalTokenCount': 40}}


def raw_proposals():
    return [{'field': field, 'label': label, 'value': value,
             'evidence': [{'evidenceRef': f'e{index}', 'excerpt': value}]}
            for index, (field, label, value) in enumerate([
                ('brand', 'Marca', 'UONIFY'), ('custom:material', 'Material', 'Madera')])]


def current(client):
    response = client.get('/api/products/DURABLE/materials')
    assert response.status_code == 200, response.text
    return response.json()['job']


def reviewed_split_leaf(client, google, db, config):
    """Extiende legacy con decisiones anteriores que la reparación debe conservar."""
    service, user, job, endpoint, _, old_call = legacy(client, google, db, config)
    payload = {'id': 'pack', 'name': 'Packaging.pdf', 'segments': SEGMENTS,
               'parentId': 'split-parent', 'splitDepth': 1}
    accepted = validate_output({'proposals': raw_proposals()}, [payload])['proposals']
    assert len(accepted) == 2
    with db.connect() as c:
        c.execute("UPDATE product_material_fragments SET payload=%s WHERE job_id=%s AND id='finished'",
                  (Jsonb(payload), job['id']))
        for identifier, source_id, version, state, segments in [
                ('split-parent', 'pack', 'original-v1', 'split', SEGMENTS),
                ('stable-sibling', 'pack', 'original-v1', 'done', [{'locator': 'Página 2', 'text': 'Conserva las instrucciones.'}]),
                ('spec-finished', 'spec', 'original-json', 'done', [{'locator': '$.instrucciones', 'text': 'Conservar en lugar seco.'}])]:
            extra = {'parentId': 'split-parent'} if identifier == 'stable-sibling' else {}
            c.execute('''INSERT INTO product_material_fragments(job_id,id,source_id,version,locator,payload,state,result)
                         VALUES(%s,%s,%s,%s,%s,%s,%s,%s)''',
                      (job['id'], identifier, source_id, version, segments[0]['locator'],
                       Jsonb({'id': source_id, 'segments': segments, **extra}), state,
                       Jsonb({'observations': {source_id: 'Original conservado.'}})))
        for source_id, version in [('pack', 'original-v1'), ('spec', 'original-json')]:
            c.execute('UPDATE product_material_sources SET data=data || %s WHERE job_id=%s AND source_id=%s',
                      (Jsonb({'version': version, 'readerVersion': 'drive-segments-v2',
                              'readingCoverage': {'complete': True, 'pdfVisualProfile': 'vectors-v1'}}), job['id'], source_id))
    facts = consolidate_proposals(accepted, service.queue.sources(job['id'], user['id']),
                                  service.queue.fragments(job['id'], user['id']))
    assert len(facts['proposals']) == 2
    assert all(fact['supportStatus'] == 'supported' for fact in facts['proposals'])
    with db.connect() as c:
        c.execute('UPDATE product_material_jobs SET result=result || %s WHERE id=%s',
                  (Jsonb({'discoveryComplete': True, 'proposals': accepted, 'facts': facts}), job['id']))
    seed_previous_review(db, service, user['id'], 'DURABLE', job['id'],
                         lambda fact: 'UONIFY' if fact['label'] == 'Marca' else '')
    product = product_snapshot(client)
    facts = current(client)['facts']['proposals']
    assert {fact['status'] for fact in facts} == {'confirmed', 'rejected'}
    with db.connect() as c:
        call = c.execute('SELECT * FROM product_material_calls WHERE id=%s', (old_call,)).fetchone()
    return service, user, job, endpoint, product, facts, call


def decision(fact):
    return {key: fact.get(key) for key in ('id', 'canonicalField', 'status', 'confirmedValue',
            'confirmedField', 'confirmationOrigin', 'reviewDecision', 'reviewedRevision')}


def historical_repair(client, db, service, user, job, endpoint, revision, original_id):
    """Recover an already authorized legacy repair without admitting a new POST."""
    request_id = str(uuid4())
    with db.connect() as c:
        row = c.execute('SELECT * FROM product_material_jobs WHERE id=%s FOR UPDATE', (job['id'],)).fetchone()
        original = c.execute('SELECT * FROM product_material_fragments WHERE job_id=%s AND id=%s',
                             (job['id'], original_id)).fetchone()
        round_number = (original['payload'].get('repairRound') or 0) + 1
        identifier = sha256((original_id + ':evidence-refs-v1:' + str(round_number)).encode()).hexdigest()
        child = {**deepcopy(original['payload']), 'repairOf': original_id,
                 'repairRound': round_number, 'citationProfile': 'evidence-refs-v1'}
        child.pop('parentId', None)
        c.execute('''INSERT INTO product_material_fragments
            (job_id,id,source_id,version,locator,payload,state) VALUES(%s,%s,%s,%s,%s,%s,'pending')''',
            (job['id'], identifier, original['source_id'], original['version'], original['locator'], Jsonb(child)))
        c.execute('''UPDATE product_material_fragments SET state='superseded',
            payload=payload || %s WHERE job_id=%s AND id=%s''',
            (Jsonb({'repairReplacedBy': identifier}), job['id'], original_id))
        budget = service.queue.budget(c, row)
        result = deepcopy(row['result'])
        result.update(operation='repair_evidence', stage='queued', pauseReason=None, error=None,
                      evidenceRepair={'profile': 'evidence-refs-v1', 'selectedFragments': 1,
                                      'fragmentIds': [identifier]})
        if result.get('facts'):
            result['facts']['stale'] = True
        c.execute('''UPDATE product_material_jobs SET status='queued',revision=%s,
            pause_requested=false,max_calls=%s,max_tokens=%s,result=%s WHERE id=%s''',
            (revision, budget['usedCalls'] + CALLS_PER_WINDOW,
             budget['usedTokens'] + budget['reservedTokens'] + TOKENS_PER_WINDOW,
             Jsonb(result), job['id']))
        c.execute('''INSERT INTO product_material_controls(user_id,request_id,job_id,action,payload)
            VALUES(%s,%s,%s,'repair_evidence',%s)''',
            (user['id'], request_id, job['id'], Jsonb({'revision': revision,
                                                       'acknowledgeUnknownConsumption': False})))
        record_control_consent(c, row, request_id, 'repair_evidence', revision,
                               {'source': 'legacy_post_only', 'version': None,
                                'text': None, 'sha256': None})
    body = {'requestId': request_id, 'revision': revision}
    response = client.post(endpoint, json=body)
    assert response.status_code == 200 and response.json()['job']['status'] == 'queued'
    return response.json()['job'], body


def test_split_leaf_repair_runs_as_root_and_preserves_reviewed_decisions_and_paid_history(environment):
    config, google, db = environment
    drive = StoredDrive()
    with client_for(config, google, drive=drive, cloud=Cloud()) as client:
        service, user, job, endpoint, product, facts, old_call = reviewed_split_leaf(client, google, db, config)
        analyzer = RepairAnalyzer()
        service.analyzer = analyzer
        revision = product['revision']
        queued, body = historical_repair(client, db, service, user, job, endpoint, revision, 'finished')
        identifier = queued['evidenceRepair']['fragmentIds'][0]
        pending = next(f for f in service.queue.fragments(job['id'], user['id']) if f['id'] == identifier)
        assert pending['payload']['repairOf'] == 'finished' and pending['payload']['repairRound'] == 1
        assert 'parentId' not in pending['payload']
        assert queued['facts']['stale']
        service.run(job['id'], user['id'])
        done = current(client)
        assert done['status'] == 'ready' and done['operation'] == 'analysis', done.get('error')
        assert not done['facts'].get('stale') and not done['repairAvailable']
        assert done['coverage']['fragmentsPending'] == 0
        assert done['resolution']['technicalPendingCount'] == done['resolution']['clientPendingCount'] == 0
        assert done['resolution']['processedSources'] == done['resolution']['completeSources'] == 2
        assert len(analyzer.calls) == 1 and analyzer.calls[0]['repairOf'] == 'finished'
        assert {decision(f)['canonicalField']: decision(f) for f in done['facts']['proposals']} == {
            decision(f)['canonicalField']: decision(f) for f in facts}
        assert product_snapshot(client) == product
        assert done['budget']['usedCalls'] == 2 and done['budget']['usedTokens'] == 90
        with db.connect() as c:
            assert c.execute('SELECT * FROM product_material_calls WHERE id=%s', (old_call['id'],)).fetchone() == old_call
        stored = {f['id']: f for f in service.queue.fragments(job['id'], user['id'])}
        assert stored['finished']['state'] == 'superseded'
        assert stored['finished']['result']['discardedProposalCount'] == 2
        assert stored['finished']['payload']['repairReplacedBy'] == identifier
        assert stored[identifier]['state'] == 'done' and stored[identifier]['version'] == 'original-v1'
        assert stored['split-parent']['state'] == 'split' and stored['stable-sibling']['state'] == 'done'
        assert done['resolution']['historicalRejectionCount'] == 2
        assert {'pack', 'spec'} <= set(drive.checked) and drive.reads == []
        assert client.post(endpoint, json=body).json()['job']['status'] == 'ready'
        service.run(job['id'], user['id'])
        assert len(analyzer.calls) == 1


def test_two_failed_rounds_keep_issue_open_and_stop_automatic_repairs_without_losing_decisions(environment):
    config, google, db = environment
    with client_for(config, google, drive=StoredDrive(), cloud=Cloud()) as client:
        service, user, job, endpoint, product, facts, old_call = reviewed_split_leaf(client, google, db, config)
        analyzer = RepairAnalyzer(fail=True)
        service.analyzer = analyzer
        initial_resolved = current(client)['resolution']['resolvedCount']
        previous = 'finished'
        for round_number in (1, 2):
            queued, _ = historical_repair(client, db, service, user, job, endpoint,
                                          product['revision'], previous)
            identifier = queued['evidenceRepair']['fragmentIds'][0]
            service.run(job['id'], user['id'])
            result = current(client)
            assert result['status'] == 'ready', result.get('error')
            assert len(analyzer.calls) == round_number
            assert analyzer.calls[-1]['repairOf'] == previous and analyzer.calls[-1]['repairRound'] == round_number
            assert not result['facts'].get('stale')
            assert result['resolution']['technicalPendingCount'] == 1
            assert result['resolution']['resolvedCount'] == initial_resolved  # Un intento no resuelve el problema.
            assert result['repairAvailable'] is False
            assert result['resolution']['issues'][0]['action'] == ('repair_evidence' if round_number == 1 else 'replace_source')
            assert result['budget']['usedCalls'] == round_number + 1
            assert result['budget']['usedTokens'] == 50 + 40 * round_number
            previous = identifier
        remembered = {f['id']: decision(f) for f in result['facts']['proposals']}
        assert all(remembered[f['id']] == decision(f) for f in facts)
        assert product_snapshot(client) == product
        denied = client.post(endpoint, json=control_body('repair_evidence', revision=product['revision']))
        assert denied.status_code == 409 and denied.json()['error'] == 'materials_repair_consent_required'
        with db.connect() as c:
            assert c.execute('SELECT * FROM product_material_calls WHERE id=%s', (old_call['id'],)).fetchone() == old_call
            assert c.execute('SELECT count(*) AS n FROM product_material_calls WHERE job_id=%s', (job['id'],)).fetchone()['n'] == 3
        assert len(analyzer.calls) == 2
