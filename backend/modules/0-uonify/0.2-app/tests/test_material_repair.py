from copy import deepcopy
from uuid import uuid4
from psycopg.types.json import Jsonb
from material_control_copy import control_body
from conftest import client_for, login
from test_product_materials import FolderDrive
from test_google_cloud import Cloud
from test_material_reader_upgrade import completed, product_snapshot


def legacy(client, google, db, config):
    service, user, job, endpoint, facts = completed(client, google, db, config)
    with db.connect() as c:
        c.execute("UPDATE product_material_fragments SET state='partial',result=%s WHERE job_id=%s AND id='finished'",
            (Jsonb({'discardedProposalCount': 2, 'observations': {'pack': 'Marca visible.'}}), job['id']))
        call_id = uuid4()
        c.execute("""INSERT INTO product_material_calls(id,job_id,lease_token,fragment_ids,state,reserved_tokens,total_tokens)
            VALUES(%s,%s,%s,%s,'done',20,50)""", (call_id, job['id'], uuid4(), Jsonb(['finished'])))
    return service, user, job, endpoint.replace('upgrade-readers', 'repair-evidence'), facts, call_id


def test_new_repair_keeps_paid_calls_confirmations_source_version_and_product_unchanged(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        service, user, job, endpoint, facts, call_id = legacy(client, google, db, config)
        before = product_snapshot(client)
        assert client.get('/api/products/DURABLE/materials').json()['job']['repairAvailable'] is False
        body = control_body('repair_evidence')
        saved = client.get('/api/products/DURABLE/materials').json()['job']
        response = client.post(endpoint, json=body)
        assert response.status_code == 409 and response.json()['error'] == 'materials_repair_consent_required'
        after = client.get('/api/products/DURABLE/materials').json()['job']
        assert after == saved and after['facts']['proposals'] == facts['proposals']
        assert after['budget']['usedCalls'] == 1 and after['budget']['usedTokens'] == 50
        fragments = service.queue.fragments(job['id'], user['id'])
        old = next(f for f in fragments if f['id'] == 'finished')
        assert old['state'] == 'partial' and old['result']['discardedProposalCount'] == 2
        assert len(fragments) == 1 and old['version'] == 'original-v1'
        assert client.post(endpoint, json=body).json()['error'] == 'materials_repair_consent_required'
        assert product_snapshot(client) == before
        with db.connect() as c:
            call = c.execute('SELECT * FROM product_material_calls WHERE id=%s', (call_id,)).fetchone()
            assert call['state'] == 'done' and call['total_tokens'] == 50


def test_repair_origin_identity_and_unknown_ack_cannot_bypass_copy_gate(environment):
    config, google, db = environment
    with client_for(config, google, drive=FolderDrive(), cloud=Cloud()) as client:
        _, _, job, endpoint, _, call_id = legacy(client, google, db, config)
        body = control_body('repair_evidence', revision=2)
        assert client.post(endpoint, json=body).json()['error'] == 'materials_repair_consent_required'
        body['revision'] = 1
        assert client.post(endpoint, json=body, headers={'Origin': 'null'}).status_code == 403
        with db.connect() as c:
            c.execute("UPDATE product_material_calls SET state='unknown' WHERE id=%s", (call_id,))
        assert client.post(endpoint, json=body).json()['error'] == 'materials_repair_consent_required'
        assert client.post(endpoint, json={**body, 'acknowledgeUnknownConsumption': True}).json()['error'] == 'materials_repair_consent_required'
        google.subject, google.email = 'foreign', 'foreign@example.test'
        login(client, google)
        assert client.post(endpoint, json=body).status_code in (403, 404)
