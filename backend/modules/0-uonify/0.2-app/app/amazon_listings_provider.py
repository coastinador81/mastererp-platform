"""Listings Items europeo: lecturas reintentables, PATCH nunca se repite automáticamente."""
from datetime import datetime, timezone
import json
import re
from urllib.parse import quote
import httpx
from .amazon_catalog import AmazonCatalog, AmazonReadError, ORIGIN

MARKETS = {'A1RKKUPIHCS9HS': 'España', 'A1F83G8C2ARO7P': 'Reino Unido',
           'A13V1IB3VIYZZH': 'Francia', 'A1PA6795UKMFR9': 'Alemania',
           'APJ6JRA9NG5V4': 'Italia', 'A1805IZSGTT6HS': 'Países Bajos',
           'A2NODRKZP88ZB9': 'Suecia', 'A1C3SOZRARQ6R3': 'Polonia',
           'AMEN7PMS3EDWL': 'Bélgica', 'A28R8C7NBKEWEA': 'Irlanda'}
INCLUDED = 'issues,attributes,summaries,productTypes'


class AmazonSubmissionUnknown(AmazonReadError):
    pass


def listing_path(seller, sku=None):
    if not isinstance(seller, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', seller):
        raise AmazonReadError('invalid_seller')
    path = '/listings/2021-08-01/items/' + quote(seller, safe='')
    if sku is not None:
        if not isinstance(sku, str) or not 1 <= len(sku) <= 200 or any(ord(c) < 32 for c in sku):
            raise AmazonReadError('invalid_sku')
        path += '/' + quote(sku, safe='')
    return path


def validate_item(item, sku=None):
    # An omitted issues/attributes field is not an authoritative empty result.
    if (not isinstance(item, dict) or not isinstance(item.get('sku'), str)
            or sku is not None and item['sku'] != sku
            or not isinstance(item.get('issues'), list) or not isinstance(item.get('attributes'), dict)
            or not isinstance(item.get('summaries'), list) or not isinstance(item.get('productTypes'), list)):
        raise AmazonReadError('incomplete_listing_snapshot')
    for issue in item['issues']:
        if not isinstance(issue, dict) or not isinstance(issue.get('code'), str) or not isinstance(issue.get('message'), str):
            raise AmazonReadError('invalid_listing_issue')
    return item


class AmazonListings(AmazonCatalog):
    def search(self, seller, marketplace, page_token=None):
        params = {'marketplaceIds': marketplace, 'includedData': INCLUDED,
                  'issueLocale': 'es_ES', 'pageSize': 20, 'sortBy': 'sku', 'sortOrder': 'ASC'}
        if page_token:
            params['pageToken'] = page_token
        result = self._get(listing_path(seller), params, 'search_listings')
        if not isinstance(result.get('items'), list) or not isinstance(result.get('pagination', {}), dict):
            raise AmazonReadError('incomplete_listing_search')
        for item in result['items']:
            validate_item(item)
        token = result.get('pagination', {}).get('nextToken')
        if token is not None and (not isinstance(token, str) or len(token) > 12000):
            raise AmazonReadError('invalid_listing_cursor')
        return result

    def item(self, seller, marketplace, sku):
        return validate_item(self._get(listing_path(seller, sku), {
            'marketplaceIds': marketplace, 'includedData': INCLUDED, 'issueLocale': 'es_ES'},
            'get_listing'), sku)

    def schema(self, seller, marketplace, product_type):
        if not re.fullmatch(r'[A-Z0-9_]{1,100}', product_type or ''):
            raise AmazonReadError('invalid_product_type')
        definition = self._get('/definitions/2020-09-01/productTypes/' + product_type, {
            'sellerId': seller, 'marketplaceIds': marketplace, 'productTypeVersion': 'LATEST',
            'requirements': 'LISTING', 'requirementsEnforced': 'ENFORCED', 'locale': 'es_ES'}, 'definition_listing')
        raw, evidence = self.download_schema(definition.get('schema', {}))
        return {'schema': json.loads(raw), 'schemaHash': evidence['sha256'],
                'definition': {'productType': product_type, 'marketplaceId': marketplace,
                               'version': definition.get('productTypeVersion'), 'requirements': 'LISTING'}}

    def put(self, seller, marketplace, sku, payload):
        """Submit an approved, exact Listings Items payload once; never retry a write."""
        if not self._access:
            raise AmazonReadError('not_authenticated')
        if marketplace not in MARKETS or not isinstance(payload, dict) or set(payload) != {
                'productType', 'requirements', 'attributes'}:
            raise AmazonReadError('invalid_submission')
        attributes = payload['attributes']
        if (not isinstance(payload['productType'], str)
                or not re.fullmatch(r'[A-Z0-9_]{1,100}', payload['productType'])
                or payload['requirements'] != 'LISTING'
                or not isinstance(attributes, dict) or not attributes
                or any(not isinstance(key, str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,150}', key)
                       or not isinstance(value, list) or not value for key, value in attributes.items())):
            raise AmazonReadError('invalid_submission')
        path = listing_path(seller, sku)
        try:
            with httpx.Client(timeout=30, follow_redirects=False, transport=self.transport) as client:
                response = client.put(ORIGIN + path,
                    params={'marketplaceIds': marketplace, 'issueLocale': 'es_ES', 'includedData': 'issues'},
                    headers={'x-amz-access-token': self._access, 'user-agent': 'Uonify/0.1 (Language=Python)',
                             'x-amz-date': datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}, json=payload)
        except (httpx.HTTPError, TypeError, ValueError):
            raise AmazonSubmissionUnknown('submission_outcome_unknown') from None
        receipt = response.headers.get('x-amzn-requestid')
        if response.status_code >= 500:
            raise AmazonSubmissionUnknown('submission_outcome_unknown', response.status_code)
        if response.status_code != 200:
            raise AmazonReadError('submission_http_error', response.status_code)
        try:
            data = response.json()
            if (not isinstance(data, dict) or data.get('status') not in ('ACCEPTED', 'INVALID')
                    or not isinstance(data.get('issues', []), list)):
                raise ValueError()
        except ValueError:
            raise AmazonSubmissionUnknown('submission_outcome_unknown') from None
        return {'status': data['status'], 'submissionId': data.get('submissionId'),
                'issues': data.get('issues', []), 'requestReceipt': receipt}

    def patch(self, seller, marketplace, sku, product_type, attributes):
        if not self._access:
            raise AmazonReadError('not_authenticated')
        if not attributes or any(not re.fullmatch(r'[a-z][a-z0-9_]{0,150}', k) for k in attributes):
            raise AmazonReadError('invalid_patch')
        payload = {'productType': product_type, 'patches': [
            {'op': 'replace', 'path': '/attributes/' + key, 'value': value}
            for key, value in sorted(attributes.items())]}
        try:
            with httpx.Client(timeout=30, follow_redirects=False, transport=self.transport) as client:
                response = client.patch(ORIGIN + listing_path(seller, sku),
                    params={'marketplaceIds': marketplace, 'issueLocale': 'es_ES', 'includedData': 'issues'},
                    headers={'x-amz-access-token': self._access, 'user-agent': 'Uonify/0.1 (Language=Python)',
                             'x-amz-date': datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}, json=payload)
        except httpx.HTTPError:
            raise AmazonSubmissionUnknown('submission_outcome_unknown') from None
        receipt = response.headers.get('x-amzn-requestid')
        if response.status_code >= 500:
            raise AmazonSubmissionUnknown('submission_outcome_unknown', response.status_code)
        if response.status_code != 200:
            raise AmazonReadError('submission_http_error', response.status_code)
        try:
            data = response.json()
            if (not isinstance(data, dict) or data.get('status') not in ('ACCEPTED', 'INVALID')
                    or not isinstance(data.get('issues', []), list)):
                raise ValueError()
        except ValueError:
            raise AmazonSubmissionUnknown('submission_outcome_unknown') from None
        return {'status': data['status'], 'submissionId': data.get('submissionId'),
                'issues': data.get('issues', []), 'requestReceipt': receipt}
