"""AMZ-03: local exact-body preview; no SP-API write or external media probes."""
import pytest
from psycopg.types.json import Jsonb

from app.amazon_catalog import MARKETPLACE
from app.amazon_listings_provider import AmazonListings
from app.amazon_publish_snapshots import digest, media_url_valid
from app.products import save
from conftest import client_for, login
from test_uony import ready


def value(**properties):
    return {'type': 'array', 'minItems': 1, 'items': {'type': 'object',
        'required': list(properties), 'properties': {**properties, 'marketplace_id': {'type': 'string'}},
        'additionalProperties': False}}


SCHEMA = {'type': 'object', 'additionalProperties': False,
    'required': ['item_name', 'brand'], 'properties': {
        'item_name': value(value={'type': 'string'}),
        'brand': value(value={'type': 'string'}),
        'main_product_image_locator': value(media_location={'type': 'string'}),
        'other_product_image_locator': value(media_location={'type': 'string'}),
    }}


@pytest.fixture
def preview_env(environment, monkeypatch):
    config, google, db = environment
    network = {'put': 0, 'item': 0, 'schema': 0}

    def forbidden(name):
        def reject(*_args, **_kwargs):
            network[name] += 1
            pytest.fail(f'AMZ-03 must not call Amazon {name}')
        return reject

    for name in network:
        monkeypatch.setattr(AmazonListings, name, forbidden(name))
    with client_for(config, google) as client:
        ready(client, google, db)
        created = client.post('/api/products', json={'sku': 'BASIC', 'name': 'Basic Mini Bricks'}).json()['product']
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE google_subject=%s', (google.subject,)).fetchone()
            c.execute('''INSERT INTO amazon_connections(user_id,seller_id,refresh_encrypted)
                VALUES(%s,'SELLER_TEST','fixture-not-a-credential')''', (user['id'],))
            c.execute('''INSERT INTO product_requirement_schemas
                (user_id,product_id,seller_id,marketplace_id,product_type,reference_asin,schema,metadata)
                VALUES(%s,%s,'SELLER_TEST',%s,'TABLETOP_GAME','B07NPPMZM8',%s,%s)''',
                (user['id'], created['id'], MARKETPLACE, Jsonb(SCHEMA), Jsonb({
                    'schemaHash': digest(SCHEMA), 'requirements': 'LISTING',
                    'requirementsEnforced': 'ENFORCED', 'locale': 'es_ES'})))
            context = {'sellerId': 'SELLER_TEST', 'marketplaceId': MARKETPLACE,
                       'productType': 'TABLETOP_GAME'}
            attributes = {'item_name': [{'value': 'Basic Mini Bricks', 'marketplace_id': MARKETPLACE},
                                        {'value': 'French title', 'marketplace_id': 'A13V1IB3VIYZZH'}],
                          'brand': [{'value': 'Uonify', 'marketplace_id': MARKETPLACE}]}
            product = save(c, user, {'revision': created['revision']}, 'BASIC',
                source='fixture-amazon', amazon_state={'amazonAttributes': attributes,
                    'amazonRequirementsContext': context})
        yield client, db, google, product, network


def post(client, revision):
    return client.post('/api/products/BASIC/amazon-publish-snapshots', json={'revision': revision})


def test_exact_immutable_preview_and_replay(preview_env):
    client, db, _, product, network = preview_env
    first = post(client, product['revision'])
    assert first.status_code == 200, first.text
    snap = first.json()
    expected = {'productType': 'TABLETOP_GAME', 'requirements': 'LISTING',
                'attributes': {'item_name': [{'value': 'Basic Mini Bricks', 'marketplace_id': MARKETPLACE}],
                               'brand': [{'value': 'Uonify', 'marketplace_id': MARKETPLACE}]}}
    assert snap['payload'] == expected
    assert snap['payloadHash'] == digest(expected)
    assert snap['schemaHash'] == digest(SCHEMA)
    assert snap['productRevision'] == product['revision']
    assert snap['sellerId'] == 'SELLER_TEST' and snap['marketplaceId'] == MARKETPLACE
    assert snap['preview']['attributes'] == expected['attributes']
    assert snap['preview']['title'] == 'Basic Mini Bricks'
    assert snap['preview']['localValidation'] == 'valid'
    assert snap['preview']['mediaReadiness'] == 'missing'
    assert snap['preview']['readyToSubmit'] is False
    assert 'B07NPPMZM8' not in str(snap['payload'])
    assert post(client, product['revision']).json() == snap
    assert client.get('/api/products/BASIC/amazon-publish-snapshots/latest').json() == snap
    assert client.get('/api/products/BASIC/amazon-publish-snapshots/' + snap['snapshotId']).json() == snap
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_snapshots').fetchone()['n'] == 1
        with pytest.raises(Exception, match='immutable'):
            c.execute('UPDATE amazon_publish_snapshots SET sku=sku WHERE id=%s', (snap['snapshotId'],))
        c.rollback()
    assert network == {'put': 0, 'item': 0, 'schema': 0}


def test_old_snapshot_is_marked_stale_and_never_rewritten(preview_env):
    client, db, _, product, _ = preview_env
    before = post(client, product['revision']).json()
    edited = client.patch('/api/products/BASIC', json={'revision': product['revision'],
                                                       'name': 'Basic Mini Bricks nueva'}).json()['product']
    stale = client.get('/api/products/BASIC/amazon-publish-snapshots/' + before['snapshotId']).json()
    assert stale['payloadHash'] == before['payloadHash']
    assert stale['payload'] == before['payload']
    assert stale['preview']['sourceCurrent'] is False
    assert post(client, product['revision']).status_code == 409
    after = post(client, edited['revision']).json()
    assert after['snapshotId'] != before['snapshotId']
    assert after['payloadHash'] != before['payloadHash']
    assert after['payload']['attributes']['item_name'][0]['value'] == 'Basic Mini Bricks nueva'
    assert client.get('/api/products/BASIC/amazon-publish-snapshots/latest').json()['snapshotId'] == after['snapshotId']
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_snapshots').fetchone()['n'] == 2


def test_media_references_remain_unverified_and_are_not_imported_from_gallery(preview_env):
    client, db, _, product, network = preview_env
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
        attrs = product['amazonAttributes'] | {'main_product_image_locator': [
            {'media_location': 'https://images.example.test/basic.jpg', 'marketplace_id': MARKETPLACE}]}
        updated = save(c, user, {'revision': product['revision']}, 'BASIC', source='fixture-media',
            amazon_state={'amazonAttributes': attrs, 'amazonRequirementsContext': product['amazonRequirementsContext']})
    snap = post(client, updated['revision']).json()
    assert snap['preview']['media'] == [{'attribute': 'main_product_image_locator', 'index': 0,
                                        'url': 'https://images.example.test/basic.jpg',
                                        'availability': 'unverified'}]
    assert snap['preview']['mediaReadiness'] == 'unverified'
    assert snap['preview']['readyToSubmit'] is False
    assert network == {'put': 0, 'item': 0, 'schema': 0}
    assert media_url_valid('https://127.0.0.1/a.jpg') is False
    assert media_url_valid('data:image/png;base64,A') is False


def test_invalid_media_reference_cannot_make_a_preview_ready(preview_env):
    client, db, _, product, _ = preview_env
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
        attrs = product['amazonAttributes'] | {'main_product_image_locator': [
            {'media_location': 'http://localhost/private.png', 'marketplace_id': MARKETPLACE}]}
        updated = save(c, user, {'revision': product['revision']}, 'BASIC', source='fixture-bad-media',
            amazon_state={'amazonAttributes': attrs, 'amazonRequirementsContext': product['amazonRequirementsContext']})
    snap = post(client, updated['revision']).json()
    assert snap['preview']['localValidation'] == 'valid'
    assert snap['preview']['mediaReadiness'] == 'invalid'
    assert snap['preview']['media'][0]['availability'] == 'invalid'
    assert snap['preview']['readyToSubmit'] is False


def test_changed_seller_schema_and_other_account_cannot_reuse_snapshot(preview_env):
    client, db, google, product, _ = preview_env
    snap = post(client, product['revision']).json()
    with db.connect() as c:
        c.execute("UPDATE product_requirement_schemas SET metadata=jsonb_set(metadata,'{schemaHash}',to_jsonb(%s::text))",
                  ('f' * 64,))
    stale = client.get('/api/products/BASIC/amazon-publish-snapshots/latest').json()
    assert stale['preview']['sourceCurrent'] is False
    google.subject = 'another-user'
    google.email = 'other@example.test'
    login(client, google)
    assert client.get('/api/products/BASIC/amazon-publish-snapshots/' + snap['snapshotId']).status_code == 404
    # A second account without product access is refused before any lookup.
    assert post(client, product['revision']).status_code == 403


def test_incomplete_attributes_are_preview_only_and_product_erasure_cascades(preview_env):
    client, db, _, product, _ = preview_env
    with db.connect() as c:
        user = c.execute('SELECT * FROM users').fetchone()
        updated = save(c, user, {'revision': product['revision']}, 'BASIC', source='fixture-incomplete',
            amazon_state={'amazonAttributes': {'item_name': product['amazonAttributes']['item_name']},
                          'amazonRequirementsContext': product['amazonRequirementsContext']})
    snap = post(client, updated['revision']).json()
    assert snap['preview']['localValidation'] == 'needs_input'
    assert snap['preview']['localIssues']
    assert snap['preview']['readyToSubmit'] is False
    assert client.delete('/api/products/BASIC').status_code == 200
    with db.connect() as c:
        assert c.execute('SELECT count(*) n FROM amazon_publish_snapshots').fetchone()['n'] == 0
