"""Contrato HTTP SP-API: rutas seguras, lectura completa y envío sin reintentos."""
from types import SimpleNamespace
import json
import httpx
import pytest
from app.amazon_catalog import AmazonReadError, MARKETPLACE
from app.amazon_listings_provider import AmazonListings, AmazonSubmissionUnknown


def provider(handler):
    instance = AmazonListings(SimpleNamespace(ready=True), transport=httpx.MockTransport(handler), sleep=lambda _: None)
    instance._access = 'test-access-only'
    return instance


def item():
    return {'sku': 'A/B &+', 'issues': [], 'attributes': {}, 'summaries': [], 'productTypes': []}


def test_search_all_listing_data_cursor_and_encoded_sku():
    seen = []
    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={'items': [item()], 'pagination': {'nextToken': 'opaque'}} if len(seen) == 1 else item())
    client = provider(handler)
    assert client.search('SELLER', MARKETPLACE, 'previous')['pagination']['nextToken'] == 'opaque'
    assert dict(seen[0].url.params) == {'marketplaceIds': MARKETPLACE, 'includedData': 'issues,attributes,summaries,productTypes',
        'issueLocale': 'es_ES', 'pageSize': '20', 'sortBy': 'sku', 'sortOrder': 'ASC', 'pageToken': 'previous'}
    client.item('SELLER', MARKETPLACE, 'A/B &+')
    assert b'A%2FB%20%26%2B' in seen[1].url.raw_path
    assert all(r.headers['x-amz-access-token'] == 'test-access-only' for r in seen)


@pytest.mark.parametrize('missing', ['issues', 'attributes', 'summaries', 'productTypes'])
def test_omitted_requested_data_is_not_an_authoritative_empty_snapshot(missing):
    payload = item()
    del payload[missing]
    with pytest.raises(AmazonReadError, match='incomplete_listing_snapshot'):
        provider(lambda _: httpx.Response(200, json=payload)).item('SELLER', MARKETPLACE, payload['sku'])


def test_patch_only_replaces_authorized_top_level_attributes_and_records_receipt():
    seen = []
    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={'status': 'ACCEPTED', 'submissionId': 'S1', 'issues': []}, headers={'x-amzn-requestid': 'R1'})
    changes = {'item_name': [{'value': 'Nuevo', 'marketplace_id': MARKETPLACE}]}
    result = provider(handler).patch('SELLER', MARKETPLACE, 'SKU', 'TOY', changes)
    assert result == {'status': 'ACCEPTED', 'submissionId': 'S1', 'issues': [], 'requestReceipt': 'R1'}
    assert seen[0].method == 'PATCH'
    assert json.loads(seen[0].content) == {'productType': 'TOY', 'patches': [
        {'op': 'replace', 'path': '/attributes/item_name', 'value': changes['item_name']}]}


def test_put_submits_exact_listing_payload_once_without_validation_preview():
    seen = []
    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={'status': 'ACCEPTED', 'submissionId': 'S2', 'issues': []},
                              headers={'x-amzn-requestid': 'R2'})
    payload = {'productType': 'TOY', 'requirements': 'LISTING', 'attributes': {
        'item_name': [{'value': 'Basic Mini Bricks', 'marketplace_id': MARKETPLACE}]}}
    result = provider(handler).put('SELLER', MARKETPLACE, 'BMB-001', payload)
    assert result == {'status': 'ACCEPTED', 'submissionId': 'S2', 'issues': [], 'requestReceipt': 'R2'}
    assert len(seen) == 1 and seen[0].method == 'PUT'
    assert seen[0].url.path.endswith('/SELLER/BMB-001')
    assert dict(seen[0].url.params) == {'marketplaceIds': MARKETPLACE, 'issueLocale': 'es_ES', 'includedData': 'issues'}
    assert json.loads(seen[0].content) == payload


@pytest.mark.parametrize('payload', [
    {'productType': 'TOY', 'requirements': 'LISTING', 'attributes': {}},
    {'productType': 'TOY', 'requirements': 'LISTING_PRODUCT_ONLY', 'attributes': {'item_name': [{}]}},
    {'productType': 'TOY', 'requirements': 'LISTING', 'attributes': {'item_name': []}},
    {'productType': 'TOY', 'requirements': 'LISTING', 'attributes': {'Item Name': [{}]}},
    {'productType': 'TOY', 'requirements': 'LISTING', 'attributes': {'item_name': [{}]}, 'mode': 'VALIDATION_PREVIEW'},
])
def test_put_rejects_unapproved_shape_before_network(payload):
    seen = []
    with pytest.raises(AmazonReadError, match='invalid_submission'):
        provider(lambda request: seen.append(request)).put('SELLER', MARKETPLACE, 'SKU', payload)
    assert seen == []


@pytest.mark.parametrize('status', [500, 503, 200])
def test_ambiguous_put_never_retries(status):
    seen = []
    def handler(request):
        seen.append(request)
        return httpx.Response(status, text='ambiguous upstream response')
    payload = {'productType': 'TOY', 'requirements': 'LISTING', 'attributes': {'item_name': [{}]}}
    with pytest.raises(AmazonSubmissionUnknown):
        provider(handler).put('SELLER', MARKETPLACE, 'SKU', payload)
    assert len(seen) == 1


def test_network_put_failure_is_unknown_and_never_retried():
    seen = []
    def handler(request):
        seen.append(request)
        raise httpx.ReadTimeout('private response', request=request)
    payload = {'productType': 'TOY', 'requirements': 'LISTING', 'attributes': {'item_name': [{}]}}
    with pytest.raises(AmazonSubmissionUnknown, match='submission_outcome_unknown'):
        provider(handler).put('SELLER', MARKETPLACE, 'SKU', payload)
    assert len(seen) == 1


@pytest.mark.parametrize('status', [500, 503, 200])
def test_ambiguous_write_never_retries(status):
    seen = []
    def handler(request):
        seen.append(request)
        return httpx.Response(status, text='invalid upstream body')
    with pytest.raises(AmazonSubmissionUnknown):
        provider(handler).patch('SELLER', MARKETPLACE, 'SKU', 'TOY', {'item_name': [{'value': 'Nuevo'}]})
    assert len(seen) == 1


def test_network_write_failure_is_unknown_and_never_retried():
    seen = []
    def handler(request):
        seen.append(request)
        raise httpx.ReadTimeout('private response', request=request)
    with pytest.raises(AmazonSubmissionUnknown) as caught:
        provider(handler).patch('SELLER', MARKETPLACE, 'SKU', 'TOY', {'item_name': [{'value': 'Nuevo'}]})
    assert len(seen) == 1 and str(caught.value) == 'submission_outcome_unknown'


@pytest.mark.parametrize('status', [400, 401, 403, 429])
def test_definitive_rejection_hides_upstream_body_and_does_not_retry(status):
    seen = []
    def handler(request):
        seen.append(request)
        return httpx.Response(status, text='secret')
    with pytest.raises(AmazonReadError) as caught:
        provider(handler).patch('SELLER', MARKETPLACE, 'SKU', 'TOY', {'item_name': [{'value': 'Nuevo'}]})
    assert caught.value.status == status and len(seen) == 1 and 'secret' not in str(caught.value)
