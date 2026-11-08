"""Flujo persistente PostgreSQL con Amazon sustituido; nunca escribe en un vendedor real."""
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from app.amazon_catalog import AmazonReadError, MARKETPLACE
from app.amazon_listings_provider import AmazonSubmissionUnknown
from app.amazon_incidents_service import AmazonIncidents
from app import amazon_incidents_store as store
from conftest import client_for, login
from test_uony import ready


ISSUE = {'code': '90244', 'message': 'El título no es válido.', 'severity': 'ERROR', 'attributeNames': ['item_name']}
SCHEMA = {'type': 'object', 'properties': {'item_name': {'type': 'array', 'items': {'type': 'object',
          'properties': {'value': {'type': 'string', 'minLength': 1}, 'marketplace_id': {'type': 'string'}}, 'required': ['value']}}}}


def item(sku='SKU-REMOTE', issues=None):
    return {'sku': sku, 'issues': [deepcopy(ISSUE)] if issues is None else issues,
            'attributes': {'item_name': [{'value': 'Anterior', 'marketplace_id': MARKETPLACE}]},
            'summaries': [{'marketplaceId': MARKETPLACE, 'itemName': 'Producto remoto',
                           'lastUpdatedDate': store.iso(store.now() - timedelta(days=1))}],
            'productTypes': [{'marketplaceId': MARKETPLACE, 'productType': 'TABLETOP_GAME'}]}


class Amazon:
    def __init__(self):
        self.items = {'SKU-REMOTE': item()}
        self.pages = None
        self.read_fail = False
        self.write_fail = None
        self.calls = []
        self.schema_hash = 'schema-one'
        self.response = {'status': 'ACCEPTED', 'submissionId': 'submission-fixture', 'issues': []}

    def authenticate(self, _refresh):
        pass

    def item(self, seller, market, sku):
        if self.read_fail:
            raise AmazonReadError('network')
        return deepcopy(self.items[sku])

    def search(self, seller, market, token=None):
        if self.read_fail:
            raise AmazonReadError('network')
        return deepcopy(self.pages[token] if self.pages else {'items': list(self.items.values()), 'numberOfResults': len(self.items)})

    def schema(self, seller, market, product_type):
        return {'schema': deepcopy(SCHEMA), 'schemaHash': self.schema_hash, 'definition': {'productType': product_type}}

    def patch(self, seller, market, sku, product_type, attributes):
        self.calls.append((seller, market, sku, deepcopy(attributes)))
        if self.write_fail:
            raise self.write_fail
        return deepcopy(self.response)


@pytest.fixture
def incident_env(environment):
    config, google, database = environment
    amazon = Amazon()
    service = AmazonIncidents(config, database, SimpleNamespace(ready=True), lambda _: amazon)
    with client_for(config, google, incidents=service) as client:
        ready(client, google, database)
        with database.connect() as c:
            user = c.execute('SELECT id FROM users').fetchone()['id']
            c.execute('''INSERT INTO amazon_connections(user_id,seller_id,refresh_encrypted)
                VALUES(%s,'SELLER_TEST',%s)''', (user, Fernet(config.encryption_key).encrypt(b'test-only-refresh').decode()))
        yield config, google, database, client, user, amazon, service


def validate(_schema, attributes, changed):
    assert changed == {'item_name'}
    if not attributes['item_name'][0]['value']:
        raise HTTPException(400, detail={'error': 'invalid_attributes'})


def prepared(env):
    _, _, _, _, user, _, service = env
    incident = service.sync(user)['incidents'][0]
    changes = {'item_name': [{'value': 'Corregido', 'marketplace_id': MARKETPLACE}]}
    return service.prepare(user, incident['id'], incident['revision'], changes, str(uuid4()), validate)


def applied(env, clear=True):
    _, _, database, _, user, amazon, service = env
    with database.connect() as c:
        row = c.execute('SELECT * FROM amazon_incident_submissions ORDER BY sent_at DESC LIMIT 1').fetchone()
    amazon.items['SKU-REMOTE']['attributes'] = deepcopy(row['attributes'])
    amazon.items['SKU-REMOTE']['summaries'][0]['lastUpdatedDate'] = store.iso(row['sent_at'] + timedelta(seconds=1))
    if clear:
        amazon.items['SKU-REMOTE']['issues'] = []
    return service.sync(user, sku='SKU-REMOTE')


def test_global_catalog_remote_skus_persist_and_reopen_without_duplicates(incident_env):
    _, _, db, client, user, amazon, service = incident_env
    assert client.post('/api/product-incidents/sync', json={}, headers={'Origin': 'null'}).status_code == 403
    result = client.post('/api/product-incidents/sync', json={}).json()
    incident = result['incidents'][0]
    assert result['summary'] == {'active': 1, 'products': 1, 'blocking': 1, 'warnings': 0}
    assert incident['productId'] is None and incident['sku'] == 'SKU-REMOTE'
    amazon.items['SKU-REMOTE']['issues'][0]['message'] = 'Mensaje actualizado por Amazon.'
    other = service.sync(user)['incidents'][0]
    assert other['id'] == incident['id'] and other['revision'] > incident['revision']
    amazon.items['SKU-REMOTE']['issues'] = []
    assert service.sync(user)['incidents'] == []
    assert service.get(user, incident['id'])['status'] == 'resolved'
    amazon.items['SKU-REMOTE']['issues'] = [ISSUE]
    assert service.sync(user)['incidents'][0]['id'] == incident['id']
    assert service.get(user, incident['id'])['status'] == 'needs_attention'
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM amazon_incidents').fetchone()['n'] == 1


def test_prepare_save_accepted_wait_and_confirmed_application(incident_env):
    _, _, _, _, user, amazon, service = incident_env
    correction = prepared(incident_env)
    assert correction['status'] == 'correction_ready' and not amazon.calls
    request_id = str(uuid4())
    sent = service.submit(user, correction['id'], correction['revision'], request_id, validate)
    assert sent['status'] == 'awaiting_amazon' and sent['submissionStatus'] == 'accepted'
    assert service.submit(user, correction['id'], correction['revision'], request_id, validate) == sent
    assert len(amazon.calls) == 1
    amazon.items['SKU-REMOTE']['issues'] = []
    # Absence alone is insufficient, including a later read with stale summary.
    assert service.sync(user, sku='SKU-REMOTE')['incidents'][0]['status'] == 'awaiting_amazon'
    amazon.items['SKU-REMOTE']['attributes'] = deepcopy(correction['correction']['attributes'])
    assert service.sync(user, sku='SKU-REMOTE')['incidents'][0]['status'] == 'awaiting_amazon'
    applied(incident_env)
    assert service.get(user, correction['id'])['status'] == 'resolved'


def test_issue_persists_after_verified_application_requires_new_correction(incident_env):
    _, _, _, _, user, _, service = incident_env
    correction = prepared(incident_env)
    service.submit(user, correction['id'], correction['revision'], str(uuid4()), validate)
    result = applied(incident_env, clear=False)['incidents'][0]
    assert result['status'] == 'needs_attention' and result['correction'] is None
    assert result['history'][-1]['event'] == 'correction_required'


def test_network_failure_partial_pages_and_disconnect_never_clear_known_issues(incident_env):
    _, _, db, _, user, amazon, service = incident_env
    incident = service.sync(user)['incidents'][0]
    amazon.read_fail = True
    failed = service.sync(user)
    assert failed['sync']['state'] == 'error' and failed['summary']['active'] == 1
    amazon.read_fail = False
    clean = item(issues=[])
    amazon.pages = {None: {'items': [clean], 'pagination': {'nextToken': 'page-two'}, 'numberOfResults': 2},
                    'page-two': {'items': [item('SKU-TWO', issues=[])], 'numberOfResults': 2}}
    first = service.sync(user)
    assert first['sync']['state'] == 'partial' and first['summary']['active'] == 1
    assert service.get(user, incident['id'])['status'] == 'needs_attention'
    second = service.sync(user, cursor=first['sync']['nextToken'])
    assert second['sync']['state'] == 'ok' and second['summary']['active'] == 0
    amazon.pages = None
    amazon.items['SKU-REMOTE']['summaries'][0]['lastUpdatedDate'] = store.iso(store.now())
    service.sync(user)
    with db.connect() as c:
        c.execute('DELETE FROM amazon_connections WHERE user_id=%s', (user,))
    disconnected = service.listing(user)
    assert not disconnected['connection']['connected'] and disconnected['summary']['active'] == 1


def test_unknown_submission_replay_does_not_resend_and_can_reconcile(incident_env):
    _, _, _, _, user, amazon, service = incident_env
    correction = prepared(incident_env)
    amazon.write_fail = AmazonSubmissionUnknown('network')
    request_id = str(uuid4())
    result = service.submit(user, correction['id'], correction['revision'], request_id, validate)
    assert result['submissionStatus'] == 'unknown' and result['status'] == 'awaiting_amazon'
    service.submit(user, correction['id'], correction['revision'], request_id, validate)
    assert len(amazon.calls) == 1
    applied(incident_env)
    assert service.get(user, correction['id'])['status'] == 'resolved'


def test_conflicts_schema_changes_remote_changes_and_validation_fail_before_writes(incident_env):
    _, _, _, _, user, amazon, service = incident_env
    correction = prepared(incident_env)
    with pytest.raises(HTTPException) as error:
        service.submit(user, correction['id'], correction['revision'] - 1, str(uuid4()), validate)
    assert error.value.status_code == 409
    amazon.schema_hash = 'new-schema'
    with pytest.raises(HTTPException) as error:
        service.submit(user, correction['id'], correction['revision'], str(uuid4()), validate)
    assert error.value.detail['error'] == 'amazon_schema_changed'
    amazon.schema_hash = 'schema-one'
    amazon.items['SKU-REMOTE']['attributes']['item_name'][0]['value'] = 'Editado en Seller Central'
    with pytest.raises(HTTPException) as error:
        service.submit(user, correction['id'], correction['revision'], str(uuid4()), validate)
    assert error.value.detail['error'] == 'amazon_listing_changed'
    assert not amazon.calls


def test_user_seller_and_sku_mapping_isolation(incident_env):
    _, google, db, client, user, amazon, service = incident_env
    client.post('/api/products', json={'sku': 'SKU-REMOTE', 'name': 'Mismo SKU'})
    incident = service.sync(user)['incidents'][0]
    assert incident['productId']
    google.subject, google.email = 'other', 'other@example.test'
    login(client, google)
    assert client.get('/api/product-incidents').json()['incidents'] == []
    assert client.get('/api/product-incidents/' + incident['id']).status_code == 404
    with db.connect() as c:
        c.execute("UPDATE amazon_connections SET seller_id='OTHER_SELLER' WHERE user_id=%s", (user,))
    assert service.listing(user)['incidents'] == []
    with pytest.raises(HTTPException):
        service.get(user, incident['id'])


def test_stale_snapshot_and_duplicate_cursor_never_resolve(incident_env):
    _, _, _, _, user, amazon, service = incident_env
    incident = service.sync(user)['incidents'][0]
    amazon.items['SKU-REMOTE']['issues'] = []
    amazon.items['SKU-REMOTE']['summaries'][0]['lastUpdatedDate'] = store.iso(store.now() - timedelta(days=5))
    assert service.sync(user, sku='SKU-REMOTE')['summary']['active'] == 1
    amazon.pages = {None: {'items': [item()], 'pagination': {'nextToken': 'same'}},
                    'same': {'items': [item(issues=[])], 'pagination': {'nextToken': 'same'}}}
    first = service.sync(user)
    assert service.sync(user, cursor=first['sync']['nextToken'])['sync']['state'] == 'error'
    assert service.get(user, incident['id'])['status'] == 'needs_attention'


def test_synchronous_rejection_preserves_messages_and_requires_review(incident_env):
    _, _, _, _, user, amazon, service = incident_env
    correction = prepared(incident_env)
    amazon.response = {'status': 'INVALID', 'issues': [{**ISSUE, 'message': 'Amazon rechaza este valor.'}]}
    result = service.submit(user, correction['id'], correction['revision'], str(uuid4()), validate)
    assert result['status'] == 'needs_attention' and result['submissionStatus'] == 'rejected'
    assert result['message'] == 'Amazon rechaza este valor.'


def test_single_sku_error_survives_get_and_other_market_counts_are_global(incident_env):
    _, _, _, client, user, amazon, service = incident_env
    service.sync(user, sku='SKU-REMOTE')
    amazon.read_fail = True
    service.sync(user, sku='SKU-REMOTE')
    result = client.get('/api/product-incidents', params={'sku': 'SKU-REMOTE'}).json()
    assert result['sync']['state'] == 'error' and result['summary']['active'] == 1
    assert result['sync']['lastCheckedAt']
    amazon.read_fail = False
    france = 'A13V1IB3VIYZZH'
    amazon.items['SKU-REMOTE']['summaries'][0]['marketplaceId'] = france
    amazon.items['SKU-REMOTE']['productTypes'][0]['marketplaceId'] = france
    service.sync(user, marketplace_id=france)
    assert service.listing(user)['summary']['active'] == 2
    assert service.listing(user, marketplace_id=france)['summary']['active'] == 1


def test_request_id_fingerprint_and_foreign_market_attributes_are_protected(incident_env):
    _, _, _, _, user, amazon, service = incident_env
    incident = service.sync(user)['incidents'][0]
    request_id = str(uuid4())
    changes = {'item_name': [{'value': 'Correcto', 'marketplace_id': MARKETPLACE}]}
    first = service.prepare(user, incident['id'], incident['revision'], changes, request_id, validate)
    assert service.prepare(user, incident['id'], incident['revision'], changes, request_id, validate) == first
    changes['item_name'][0]['value'] = 'Otro'
    with pytest.raises(HTTPException) as caught:
        service.prepare(user, incident['id'], incident['revision'], changes, request_id, validate)
    assert caught.value.detail['error'] == 'request_conflict'
    amazon.items['SKU-REMOTE']['attributes']['item_name'].append({'value': 'Français', 'marketplace_id': 'A13V1IB3VIYZZH'})
    with pytest.raises(HTTPException) as caught:
        service.prepare(user, incident['id'], first['revision'], changes, str(uuid4()), validate)
    assert caught.value.detail['error'] == 'other_marketplace_changed'


def test_truncated_search_preserves_incident_and_expired_cursor_is_rejected(incident_env):
    _, _, _, _, user, amazon, service = incident_env
    service.sync(user)
    amazon.pages = {None: {'items': [item(issues=[])], 'numberOfResults': 2}}
    result = service.sync(user)
    assert result['sync']['state'] == 'error' and result['summary']['active'] == 1
    with pytest.raises(HTTPException) as caught:
        service.sync(user, cursor='old-cursor')
    assert caught.value.status_code == 409


def test_crash_after_durable_send_can_reconcile_without_repeating(incident_env):
    _, _, db, _, user, amazon, service = incident_env
    correction = prepared(incident_env)
    request_id = str(uuid4())
    original = amazon.patch
    def crash(*args):
        original(*args)
        raise RuntimeError('process stopped after network dispatch')
    amazon.patch = crash
    with pytest.raises(RuntimeError):
        service.submit(user, correction['id'], correction['revision'], request_id, validate)
    with db.connect() as c:
        assert c.execute('SELECT status FROM amazon_incident_submissions').fetchone()['status'] == 'sending'
    replay = service.submit(user, correction['id'], correction['revision'], request_id, validate)
    assert replay['status'] == 'awaiting_amazon' and len(amazon.calls) == 1
    applied(incident_env)
    assert service.get(user, correction['id'])['status'] == 'resolved'


def test_receipt_arriving_after_reconciliation_does_not_reopen_incident(incident_env):
    _, _, _, _, user, amazon, service = incident_env
    correction = prepared(incident_env)
    original = amazon.patch
    def delayed(*args):
        result = original(*args)
        applied(incident_env)
        return result
    amazon.patch = delayed
    result = service.submit(user, correction['id'], correction['revision'], str(uuid4()), validate)
    assert result['status'] == 'resolved' and len(amazon.calls) == 1


def test_parallel_incidents_cannot_overwrite_attributes_awaiting_amazon(incident_env):
    _, _, _, _, user, amazon, service = incident_env
    amazon.items['SKU-REMOTE']['issues'].append({**ISSUE, 'code': 'OTHER_ERROR'})
    issues = service.sync(user)['incidents']
    first, second = issues
    changes = {'item_name': [{'value': 'Corregido', 'marketplace_id': MARKETPLACE}]}
    correction = service.prepare(user, first['id'], first['revision'], changes, str(uuid4()), validate)
    service.submit(user, first['id'], correction['revision'], str(uuid4()), validate)
    with pytest.raises(HTTPException) as caught:
        service.prepare(user, second['id'], second['revision'], changes, str(uuid4()), validate)
    assert caught.value.detail['error'] == 'attribute_submission_pending'
