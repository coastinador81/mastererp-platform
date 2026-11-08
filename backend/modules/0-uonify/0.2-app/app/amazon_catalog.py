"""Lectura SP-API europea y descarga PTD. Nunca expone credenciales ni URLs firmadas."""
import base64
from datetime import datetime, timezone
import hashlib
import json
import re
import time
from urllib.parse import urlsplit, quote
import httpx

ORIGIN = 'https://sellingpartnerapi-eu.amazon.com'
MARKETPLACE = 'A1RKKUPIHCS9HS'


class AmazonReadError(Exception):
    def __init__(self, code, status=None):
        super().__init__(code)
        self.code, self.status = code, status


class AmazonCatalog:
    def __init__(self, config, transport=None, sleep=time.sleep):
        self.config, self.transport, self.sleep = config, transport, sleep
        self._access = None
        self.receipts = []

    def _request(self, method, url, operation, **kwargs):
        for attempt in range(3):
            try:
                with httpx.Client(timeout=30, follow_redirects=False, transport=self.transport) as client:
                    response = client.request(method, url, **kwargs)
            except httpx.HTTPError:
                if attempt < 2:
                    self.sleep(2 ** attempt)
                    continue
                raise AmazonReadError(operation + '_network_error') from None
            if response.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                wait = response.headers.get('retry-after', '')
                self.sleep(min(30, max(1, float(wait))) if re.fullmatch(r'\d+(\.\d+)?', wait) else 2 ** attempt)
                continue
            self.receipts.append({'operation': operation, 'status': response.status_code,
                                  'requestId': response.headers.get('x-amzn-requestid'),
                                  'rateLimit': response.headers.get('x-amzn-ratelimit-limit')})
            if response.status_code != 200:
                raise AmazonReadError(operation + '_http_error', response.status_code)
            return response

    def authenticate(self, refresh):
        if not self.config.ready:
            raise AmazonReadError('amazon_not_configured')
        response = self._request('POST', 'https://api.amazon.com/auth/o2/token', 'lwa_refresh', data={
            'grant_type': 'refresh_token', 'refresh_token': refresh,
            'client_id': self.config.client_id, 'client_secret': self.config.client_secret})
        try:
            token = response.json().get('access_token')
        except (ValueError, AttributeError):
            raise AmazonReadError('invalid_lwa_response') from None
        if not isinstance(token, str) or not 20 <= len(token) <= 16384:
            raise AmazonReadError('invalid_lwa_response')
        self._access = token

    def _get(self, path, params, operation):
        if not self._access:
            raise AmazonReadError('not_authenticated')
        response = self._request('GET', ORIGIN + path, operation, params=params, headers={
            'x-amz-access-token': self._access, 'user-agent': 'Uonify/0.1 (Language=Python)',
            'x-amz-date': datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')})
        try:
            data = response.json()
        except ValueError:
            raise AmazonReadError('invalid_' + operation + '_json') from None
        if not isinstance(data, dict):
            raise AmazonReadError('invalid_' + operation + '_json')
        return data

    def catalog_item(self, asin):
        if not re.fullmatch(r'[A-Z0-9]{10}', asin):
            raise AmazonReadError('invalid_asin')
        return self._get('/catalog/2022-04-01/items/' + asin, {
            'marketplaceIds': MARKETPLACE, 'includedData': 'productTypes,classifications,summaries',
            'locale': 'es_ES'}, 'catalog_item')

    def definition(self, product_type, seller, requirements):
        if not re.fullmatch(r'[A-Z0-9_]{1,100}', product_type):
            raise AmazonReadError('invalid_product_type')
        if requirements not in ('LISTING', 'LISTING_PRODUCT_ONLY'):
            raise AmazonReadError('invalid_requirements')
        return self._get('/definitions/2020-09-01/productTypes/' + quote(product_type), {
            'sellerId': seller, 'marketplaceIds': MARKETPLACE, 'productTypeVersion': 'LATEST',
            'requirements': requirements, 'requirementsEnforced': 'ENFORCED', 'locale': 'es_ES'},
            'definition_' + requirements.lower())

    def download_schema(self, resource):
        # Destino S3 HTTPS proporcionado por PTD; sin credenciales SP-API ni redirecciones.
        url = resource.get('link', {}).get('resource', '')
        try:
            parsed = urlsplit(url)
            if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443)
                    or not re.fullmatch(r'[a-z0-9.-]+\.amazonaws\.com', parsed.hostname or '')
                    or not any(p == 's3' or p.startswith('s3-') for p in (parsed.hostname or '').split('.'))):
                raise ValueError()
        except ValueError:
            raise AmazonReadError('invalid_schema_host') from None
        response = self._request('GET', url, 'schema_download')
        raw = response.content
        if len(raw) > 20_000_000:
            raise AmazonReadError('schema_too_large')
        checksum = base64.b64encode(hashlib.md5(raw).digest()).decode()
        if checksum != resource.get('checksum'):
            raise AmazonReadError('schema_checksum_mismatch')
        try:
            data = json.loads(raw)
        except ValueError:
            raise AmazonReadError('invalid_schema_json') from None
        if not isinstance(data, dict):
            raise AmazonReadError('invalid_schema_json')
        return raw, {'md5Base64': checksum, 'sha256': hashlib.sha256(raw).hexdigest(),
                     'bytes': len(raw), 'sourceHost': parsed.hostname}
