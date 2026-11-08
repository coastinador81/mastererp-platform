"""Consultas SP-API y PTD con transporte ficticio; sin tráfico ni credenciales reales."""
import base64
from contextlib import nullcontext
import hashlib
import json
from types import SimpleNamespace
from urllib.parse import parse_qs

import httpx
import pytest

from app.amazon_catalog import AmazonCatalog, AmazonReadError, MARKETPLACE


ACCESS = 'access-for-unit-tests-only'
REFRESH = 'refresh-for-unit-tests-only'
SECRET = 'client-secret-for-unit-tests-only'
SIGNED_URL = ('https://example-ptd.s3.eu-west-1.amazonaws.com/schema.json'
              '?X-Amz-Signature=signature-for-unit-tests-only')
SCHEMA = b'{"type":"object","properties":{"item_name":{"type":"string"}}}'


def resource(raw=SCHEMA, url=SIGNED_URL):
    return {'link': {'resource': url},
            'checksum': base64.b64encode(hashlib.md5(raw).digest()).decode()}


def reader(handler, sleeps=None):
    config = SimpleNamespace(ready=True, client_id='test-client', client_secret=SECRET)
    return AmazonCatalog(config, transport=httpx.MockTransport(handler),
                         sleep=(sleeps if sleeps is not None else []).append)


def test_refresh_token_used_only_at_lwa_and_not_exposed_in_receipts():
    requests = []

    def respond(request):
        requests.append(request)
        assert str(request.url) == 'https://api.amazon.com/auth/o2/token'
        assert request.method == 'POST'
        assert parse_qs(request.content.decode()) == {
            'grant_type': ['refresh_token'], 'refresh_token': [REFRESH],
            'client_id': ['test-client'], 'client_secret': [SECRET]}
        return httpx.Response(200, json={'access_token': ACCESS})

    client = reader(respond)
    assert client.authenticate(REFRESH) is None
    assert len(requests) == 1
    summary = json.dumps(client.receipts)
    assert all(value not in summary for value in (ACCESS, REFRESH, SECRET))


def test_catalog_and_product_definitions_use_seller_market_and_enforced_requirements():
    seen = []

    def respond(request):
        seen.append(request)
        assert request.method == 'GET'
        assert request.headers['x-amz-access-token'] == ACCESS
        assert 'authorization' not in request.headers
        assert request.url.host == 'sellingpartnerapi-eu.amazon.com'
        return httpx.Response(200, json={'ok': True})

    client = reader(respond)
    client._access = ACCESS
    assert client.catalog_item('B07NPPMZM8') == {'ok': True}
    assert dict(seen[0].url.params) == {
        'marketplaceIds': MARKETPLACE, 'locale': 'es_ES',
        'includedData': 'productTypes,classifications,summaries'}
    assert seen[0].url.path == '/catalog/2022-04-01/items/B07NPPMZM8'
    for requirements in ('LISTING', 'LISTING_PRODUCT_ONLY'):
        client.definition('TABLETOP_GAME', 'SELLER_TEST', requirements)
        assert seen[-1].url.path == '/definitions/2020-09-01/productTypes/TABLETOP_GAME'
        assert dict(seen[-1].url.params) == {
            'sellerId': 'SELLER_TEST', 'marketplaceIds': MARKETPLACE,
            'productTypeVersion': 'LATEST', 'requirements': requirements,
            'requirementsEnforced': 'ENFORCED', 'locale': 'es_ES'}


@pytest.mark.parametrize('method,args,code', [
    ('catalog_item', ('../../oops',), 'invalid_asin'),
    ('catalog_item', ('b07nppmzm8',), 'invalid_asin'),
    ('definition', ('../TOY', 'SELLER', 'LISTING'), 'invalid_product_type'),
    ('definition', ('TOY', 'SELLER', 'LISTING_OFFER_ONLY'), 'invalid_requirements'),
])
def test_invalid_query_inputs_do_not_send_any_request(method, args, code):
    def unexpected(_request):
        pytest.fail('Invalid parameters must not reach the network')

    with pytest.raises(AmazonReadError, match=code):
        getattr(reader(unexpected), method)(*args)


def test_catalog_requires_authentication():
    client = reader(lambda _: pytest.fail('Unauthenticated network request'))
    with pytest.raises(AmazonReadError, match='not_authenticated'):
        client.catalog_item('B07NPPMZM8')


@pytest.mark.parametrize('payload', [{}, [], {'access_token': 'too-short'},
                                      {'access_token': 123}, {'access_token': 'x' * 16385}])
def test_invalid_lwa_payload_is_sanitized(payload):
    client = reader(lambda _: httpx.Response(200, json=payload))
    with pytest.raises(AmazonReadError, match='invalid_lwa_response'):
        client.authenticate(REFRESH)


@pytest.mark.parametrize('status', [400, 401, 403, 404, 302])
def test_non_retryable_errors_hide_remote_body_and_do_not_follow_redirects(status):
    seen = []

    def respond(request):
        seen.append(request)
        return httpx.Response(status, text='private: ' + ACCESS + SECRET + SIGNED_URL,
                              headers={'location': 'https://attacker.example/collect'})

    client = reader(respond)
    client._access = ACCESS
    with pytest.raises(AmazonReadError) as caught:
        client.catalog_item('B07NPPMZM8')
    assert caught.value.code == 'catalog_item_http_error'
    assert caught.value.status == status
    assert len(seen) == 1
    assert str(caught.value) == 'catalog_item_http_error'
    assert ACCESS not in json.dumps(client.receipts)
    assert SIGNED_URL not in json.dumps(client.receipts)


@pytest.mark.parametrize('status', [429, 500, 502, 503, 504])
def test_retryable_http_statuses_stop_after_three_attempts(status):
    seen, sleeps = [], []

    def respond(request):
        seen.append(request)
        return httpx.Response(status, text=SECRET)

    client = reader(respond, sleeps)
    client._access = ACCESS
    with pytest.raises(AmazonReadError) as caught:
        client.catalog_item('B07NPPMZM8')
    assert caught.value.status == status
    assert len(seen) == 3
    assert sleeps == [1, 2]


@pytest.mark.parametrize('header,expected', [('999999', 30), ('0', 1), ('1.5', 1.5),
                                             ('invalid', 1), ('-10', 1)])
def test_retry_after_is_bounded_and_success_does_not_retry(header, expected):
    seen, sleeps = [], []

    def respond(request):
        seen.append(request)
        if len(seen) == 1:
            return httpx.Response(429, headers={'retry-after': header})
        return httpx.Response(200, json={'ok': True})

    client = reader(respond, sleeps)
    client._access = ACCESS
    assert client.catalog_item('B07NPPMZM8') == {'ok': True}
    assert sleeps == [expected]
    assert len(seen) == 2


def test_network_failure_is_bounded_and_does_not_leak_request_or_signed_url():
    seen, sleeps = [], []

    def fail(request):
        seen.append(request)
        raise httpx.ConnectError(SECRET + SIGNED_URL, request=request)

    client = reader(fail, sleeps)
    with pytest.raises(AmazonReadError) as caught:
        client.download_schema(resource())
    assert str(caught.value) == 'schema_download_network_error'
    assert caught.value.__suppress_context__
    assert len(seen) == 3
    assert sleeps == [1, 2]


def test_schema_download_never_sends_lwa_headers_and_verifies_raw_checksum():
    seen = []

    def respond(request):
        seen.append(request)
        assert request.method == 'GET'
        assert str(request.url) == SIGNED_URL
        assert 'x-amz-access-token' not in request.headers
        assert 'authorization' not in request.headers
        assert 'cookie' not in request.headers
        assert all(value not in str(request.headers) for value in (ACCESS, REFRESH, SECRET))
        return httpx.Response(200, content=SCHEMA)

    client = reader(respond)
    client._access = ACCESS
    raw, metadata = client.download_schema(resource())
    assert raw == SCHEMA
    assert metadata == {
        'md5Base64': resource()['checksum'], 'sha256': hashlib.sha256(SCHEMA).hexdigest(),
        'bytes': len(SCHEMA), 'sourceHost': 'example-ptd.s3.eu-west-1.amazonaws.com'}
    assert len(seen) == 1
    assert SIGNED_URL not in json.dumps(metadata)
    assert 'Signature' not in json.dumps(client.receipts)


@pytest.mark.parametrize('url', [
    'http://bucket.s3.amazonaws.com/schema',
    'https://bucket.s3.amazonaws.com.evil.test/schema',
    'https://s3.amazonaws.com@evil.test/schema',
    'https://user:pass@bucket.s3.amazonaws.com/schema',
    'https://bucket.s3.amazonaws.com:8080/schema',
    'https://bucket.ec2.amazonaws.com/schema',
    'https://s3.evil.test/schema',
    'https://127.0.0.1/schema',
    'file:///tmp/schema',
])
def test_schema_rejects_untrusted_hosts_without_sending_a_request(url):
    client = reader(lambda _: pytest.fail('Untrusted schema host requested'))
    with pytest.raises(AmazonReadError, match='invalid_schema_host'):
        client.download_schema(resource(url=url))


def test_schema_checksum_mismatch_rejects_changed_content():
    client = reader(lambda _: httpx.Response(200, content=SCHEMA + b' '))
    with pytest.raises(AmazonReadError, match='schema_checksum_mismatch'):
        client.download_schema(resource())


@pytest.mark.parametrize('raw', [b'not-json', b'[]', b'null'])
def test_correct_checksum_does_not_make_invalid_schema_acceptable(raw):
    client = reader(lambda _: httpx.Response(200, content=raw))
    with pytest.raises(AmazonReadError, match='invalid_schema_json'):
        client.download_schema(resource(raw))


def test_oversized_schema_is_rejected():
    raw = b' ' * 20_000_001
    client = reader(lambda _: httpx.Response(200, content=raw))
    with pytest.raises(AmazonReadError, match='schema_too_large'):
        client.download_schema(resource(raw))


@pytest.mark.parametrize('raw', [b'not-json', b'[]', b'null'])
def test_catalog_requires_an_object_json(raw):
    client = reader(lambda _: httpx.Response(200, content=raw))
    client._access = ACCESS
    with pytest.raises(AmazonReadError, match='invalid_catalog_item_json'):
        client.catalog_item('B07NPPMZM8')


def test_export_saves_both_scopes_checksums_and_local_resource_links(tmp_path, monkeypatch):
    from cryptography.fernet import Fernet
    from app import amazon_schema_export as module

    encryption_key = Fernet.generate_key()
    rows = iter([
        {'id': 'fake-user', 'email': 'reader@example.test'},
        {'seller_id': 'SELLER_TEST',
         'refresh_encrypted': Fernet(encryption_key).encrypt(REFRESH.encode()).decode()},
    ])
    db = SimpleNamespace(execute=lambda *_: SimpleNamespace(fetchone=lambda: next(rows)))
    monkeypatch.setattr(module, 'Database', lambda _: SimpleNamespace(connect=lambda: nullcontext(db)))
    monkeypatch.setattr(module, 'workspace_access', lambda *_: {'status': 'allowed'})
    config = SimpleNamespace(ready=True, client_id='test-client', client_secret=SECRET)
    monkeypatch.setattr(module, 'load_config', lambda _: config)
    seen = []

    def respond(request):
        seen.append(request)
        if request.url.host == 'api.amazon.com':
            return httpx.Response(200, json={'access_token': ACCESS})
        if request.url.path.startswith('/catalog/'):
            return httpx.Response(200, json={'asin': 'B07NPPMZM8', 'productTypes': [
                {'marketplaceId': MARKETPLACE, 'productType': 'TABLETOP_GAME'},
                {'marketplaceId': 'OTHER_MARKETPLACE', 'productType': 'IGNORED'},
            ]})
        if request.url.path.startswith('/definitions/'):
            return httpx.Response(200, json={
                'productTypeVersion': {'version': 'fixture-version', 'latest': True},
                'schema': resource(), 'metaSchema': resource(),
            })
        assert request.url.host == 'example-ptd.s3.eu-west-1.amazonaws.com'
        assert 'x-amz-access-token' not in request.headers
        return httpx.Response(200, content=SCHEMA)

    monkeypatch.setattr(module, 'AmazonCatalog', lambda cfg: AmazonCatalog(
        cfg, transport=httpx.MockTransport(respond), sleep=lambda _: None))
    output = tmp_path / 'export'
    result = module.export_reference(SimpleNamespace(database={}, encryption_key=encryption_key),
                                     'reader@example.test', 'B07NPPMZM8', output)
    assert result['checksumsVerified'] is True
    assert result['productType'] == 'TABLETOP_GAME'
    assert len(seen) == 8
    manifest = json.loads((output / 'manifest.json').read_text())
    assert set(manifest['definitions']) == {'LISTING', 'LISTING_PRODUCT_ONLY'}
    assert manifest['sellerId'] == 'SELLER_TEST'
    assert manifest['marketplaceId'] == MARKETPLACE
    assert manifest['requirementsEnforced'] == 'ENFORCED'
    assert manifest['locale'] == 'es_ES'
    assert manifest['requestedVersion'] == 'LATEST'
    for prefix in ('listing', 'listing_product_only'):
        definition = json.loads((output / (prefix + '.definition.json')).read_text())
        assert definition['schema']['link']['resource'] == prefix + '.schema.json'
        assert definition['metaSchema']['link']['resource'] == prefix + '.metaschema.json'
        assert (output / (prefix + '.schema.json')).read_bytes() == SCHEMA
        assert (output / (prefix + '.metaschema.json')).read_bytes() == SCHEMA
    saved = '\n'.join(path.read_text() for path in output.iterdir())
    assert all(value not in saved for value in (SIGNED_URL, ACCESS, REFRESH, SECRET))
    assert 'X-Amz-Signature' not in saved


def test_export_error_output_does_not_expose_exception_details(monkeypatch, capsys):
    from app import amazon_schema_export as module

    monkeypatch.setattr('sys.argv', ['export', '--email', 'reader@example.test',
                                    '--asin', 'B07NPPMZM8', '--output', '/unused'])
    monkeypatch.setattr(module, 'load_settings', lambda: None)

    def fail(*_args):
        raise RuntimeError(SECRET + SIGNED_URL)

    monkeypatch.setattr(module, 'export_reference', fail)
    assert module.main() == 1
    output = capsys.readouterr()
    assert json.loads(output.out) == {'error': 'export_failed'}
    assert output.err == ''
