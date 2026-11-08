"""AMZ-03: immutable local Listings Items body and a preview read only from it.

No provider is invoked here. A locally valid PTD result is not Amazon acceptance,
and media URLs remain unverified until a durable asset service can prove them.
"""
from datetime import datetime, timezone, timedelta
from hashlib import sha256
import ipaddress
import json
import re
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, Request
from pydantic import Field
from psycopg.types.json import Jsonb

from .amazon_listings_provider import MARKETS
from .incident_schema_validation import error_detail, validation_errors
from .onboarding import StrictBody, require_user
from .product_requirements_mapping import scope_attributes
from .products import fail, find, require_access
from .security import require_origin

HASH = re.compile(r'^[0-9a-f]{64}$')
TYPE = re.compile(r'^[A-Z0-9_]{1,100}$')
ATTRIBUTE = re.compile(r'^[a-z][a-z0-9_]{0,150}$')
MAX_BODY_BYTES = 128_000


def canonical_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                      allow_nan=False).encode('utf-8')


def digest(value):
    return sha256(canonical_bytes(value)).hexdigest()


def image_locator(name):
    return name == 'main_product_image_locator' or name.endswith('_image_locator')


def media_url_valid(raw):
    if not isinstance(raw, str) or len(raw) > 2048:
        return False
    try:
        url = urlsplit(raw)
        host = url.hostname
        if url.scheme != 'https' or not host or url.username or url.password or url.fragment:
            return False
        if host.lower() == 'localhost' or host.lower().endswith('.local'):
            return False
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            return '.' in host and not host.endswith('.')
        return address.is_global
    except ValueError:
        return False


def media_from_payload(attributes):
    """Only PTD image locator values, never browser/session gallery or reference ASIN."""
    refs = []
    malformed = False
    for name, values in sorted(attributes.items()):
        if not image_locator(name):
            continue
        if not isinstance(values, list):
            malformed = True
            continue
        for index, item in enumerate(values):
            url = item.get('media_location') if isinstance(item, dict) else None
            valid = media_url_valid(url)
            if not valid:
                malformed = True
            refs.append({'attribute': name, 'index': index, 'url': url if isinstance(url, str) else None,
                         'availability': 'unverified' if valid else 'invalid'})
    if malformed:
        readiness = 'invalid'
    elif not any(ref['attribute'] == 'main_product_image_locator' for ref in refs):
        readiness = 'missing'
    else:
        readiness = 'unverified'
    return refs, readiness


def payload_from_product(product, schema_row):
    context = product['data'].get('amazonRequirementsContext')
    if not isinstance(context, dict) or context != {
            'sellerId': schema_row['seller_id'], 'marketplaceId': schema_row['marketplace_id'],
            'productType': schema_row['product_type']}:
        fail('amazon_context_stale', 'La ficha y los requisitos de Amazon no coinciden. Vuelve a revisar la categoría.', 409)
    attributes = product['data'].get('amazonAttributes')
    if not isinstance(attributes, dict):
        attributes = {}
    attributes = scope_attributes(attributes, schema_row['marketplace_id'])
    properties = schema_row['schema'].get('properties')
    if not isinstance(properties, dict):
        fail('unsupported_amazon_schema', 'No podemos validar esta versión de requisitos de Amazon.', 409)
    if (any(not ATTRIBUTE.fullmatch(name) or not isinstance(values, list) or not values
            for name, values in attributes.items())
            or set(attributes) - set(properties)):
        fail('invalid_amazon_attributes', 'Hay atributos con formato no admitido para esta revisión de Amazon.', 422)
    payload = {'productType': schema_row['product_type'], 'requirements': 'LISTING',
               'attributes': attributes}
    if len(canonical_bytes(payload)) > MAX_BODY_BYTES:
        fail('amazon_preview_too_large', 'Esta ficha supera el tamaño que podemos revisar con seguridad.', 422)
    return payload


def prepare(c, user, sku, revision):
    """Freeze the exact local body under a product-row lock; never call Amazon."""
    require_access(c, user)
    product = find(c, user, sku)
    product = c.execute('''SELECT * FROM products WHERE user_id=%s AND id=%s
        AND deleted_at IS NULL FOR UPDATE''', (user['id'], product['id'])).fetchone()
    if product['revision'] != revision:
        fail('product_conflict', 'La ficha ha cambiado. Revísala antes de preparar otra vista previa.', 409)
    context = product['data'].get('amazonRequirementsContext')
    if not isinstance(context, dict):
        fail('amazon_context_required', 'Prepara primero los requisitos de Amazon para esta ficha.', 409)
    seller, market = context.get('sellerId'), context.get('marketplaceId')
    if market not in MARKETS or not isinstance(context.get('productType'), str) or not TYPE.fullmatch(context['productType']):
        fail('amazon_context_stale', 'Revisa vendedor, mercado y tipo de producto antes de continuar.', 409)
    account = c.execute('''SELECT seller_id FROM amazon_connections WHERE user_id=%s FOR SHARE''',
                        (user['id'],)).fetchone()
    if not account or account['seller_id'] != seller:
        fail('amazon_connection_changed', 'La cuenta de vendedor ha cambiado. Vuelve a comprobar Amazon.', 409)
    schema = c.execute('''SELECT * FROM product_requirement_schemas WHERE user_id=%s AND product_id=%s
        AND seller_id=%s AND marketplace_id=%s FOR SHARE''',
        (user['id'], product['id'], seller, market)).fetchone()
    if (not schema or schema['product_type'] != context['productType']
            or datetime.now(timezone.utc) - schema['fetched_at'] > timedelta(hours=24)):
        fail('amazon_schema_stale', 'Actualiza los requisitos de Amazon antes de preparar la vista previa.', 409)
    metadata = schema['metadata']
    schema_hash = metadata.get('schemaHash')
    if (not isinstance(schema_hash, str) or not HASH.fullmatch(schema_hash)
            or metadata.get('requirements') != 'LISTING' or metadata.get('requirementsEnforced') != 'ENFORCED'):
        fail('amazon_schema_stale', 'Esta versión de requisitos necesita comprobarse de nuevo.', 409)
    payload = payload_from_product(product, schema)
    refs, media_readiness = media_from_payload(payload['attributes'])
    errors = validation_errors(schema['schema'], payload['attributes'])
    issues = [error_detail(error) for error in errors[:20]]
    local_validation = 'needs_input' if errors or not payload['attributes'] else 'valid'
    payload_hash = digest(payload)
    snapshot_hash = digest({'productId': str(product['id']), 'revision': revision, 'sku': product['sku'],
                            'sellerId': seller, 'marketplaceId': market, 'productType': schema['product_type'],
                            'schemaHash': schema_hash, 'payloadHash': payload_hash})
    row = c.execute('''INSERT INTO amazon_publish_snapshots
        (id,user_id,product_id,product_revision,sku,seller_id,marketplace_id,product_type,
         schema_hash,payload_hash,snapshot_hash,payload,media_refs,local_issues,local_validation,media_readiness)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT(user_id,product_id,snapshot_hash) DO NOTHING RETURNING *''',
        (uuid4(), user['id'], product['id'], revision, product['sku'], seller, market,
         schema['product_type'], schema_hash, payload_hash, snapshot_hash, Jsonb(payload),
         Jsonb(refs), Jsonb(issues), local_validation, media_readiness)).fetchone()
    if not row:
        row = c.execute('''SELECT * FROM amazon_publish_snapshots WHERE user_id=%s
            AND product_id=%s AND snapshot_hash=%s''',
            (user['id'], product['id'], snapshot_hash)).fetchone()
    return present_snapshot(c, user, product, row)


def present_snapshot(c, user, product, row):
    if digest(row['payload']) != row['payload_hash']:
        fail('amazon_snapshot_integrity', 'La vista previa guardada necesita revisión antes de usarse.', 409)
    expected_hash = digest({'productId': str(row['product_id']), 'revision': row['product_revision'],
                            'sku': row['sku'], 'sellerId': row['seller_id'],
                            'marketplaceId': row['marketplace_id'], 'productType': row['product_type'],
                            'schemaHash': row['schema_hash'], 'payloadHash': row['payload_hash']})
    expected_media, expected_readiness = media_from_payload(row['payload']['attributes'])
    if (expected_hash != row['snapshot_hash'] or expected_media != row['media_refs']
            or expected_readiness != row['media_readiness']):
        fail('amazon_snapshot_integrity', 'La vista previa guardada necesita revisión antes de usarse.', 409)
    schema = c.execute('''SELECT product_type,metadata,fetched_at FROM product_requirement_schemas
        WHERE user_id=%s AND product_id=%s AND seller_id=%s AND marketplace_id=%s''',
        (user['id'], product['id'], row['seller_id'], row['marketplace_id'])).fetchone()
    account = c.execute('SELECT seller_id FROM amazon_connections WHERE user_id=%s',
                        (user['id'],)).fetchone()
    current = (product['revision'] == row['product_revision'] and product['sku'] == row['sku']
               and product['data'].get('amazonRequirementsContext') == {
                   'sellerId': row['seller_id'], 'marketplaceId': row['marketplace_id'],
                   'productType': row['product_type']}
               and account is not None and account['seller_id'] == row['seller_id']
               and schema is not None and schema['product_type'] == row['product_type']
               and schema['metadata'].get('schemaHash') == row['schema_hash']
               and datetime.now(timezone.utc) - schema['fetched_at'] <= timedelta(hours=24))
    payload = row['payload']
    name = payload['attributes'].get('item_name', [])
    title = name[0].get('value') if name and isinstance(name[0], dict) else None
    limitations = ['La validación es local: Amazon todavía no ha recibido ni aceptado esta ficha.',
                   'La distribución visual, reseñas y distintivos los decide Amazon; A+, vídeo y campañas van por separado.']
    if row['media_readiness'] == 'missing':
        limitations.append('Falta una imagen principal en los atributos Amazon de esta revisión.')
    elif row['media_readiness'] == 'unverified':
        limitations.append('Las direcciones de imagen están guardadas, pero su disponibilidad y derechos aún no están verificados.')
    else:
        limitations.append('Alguna dirección de imagen no tiene un formato seguro para preparar el envío.')
    if not current:
        limitations.append('La ficha, vendedor o esquema ha cambiado desde esta vista previa. Prepara una nueva revisión.')
    return {'snapshotId': str(row['id']), 'payloadHash': row['payload_hash'],
            'snapshotHash': row['snapshot_hash'], 'productId': str(row['product_id']),
            'productRevision': row['product_revision'], 'sku': row['sku'], 'sellerId': row['seller_id'],
            'marketplaceId': row['marketplace_id'], 'productType': row['product_type'],
            'schemaHash': row['schema_hash'], 'preparedAt': row['prepared_at'].isoformat(),
            'payload': payload, 'preview': {'title': title, 'attributes': payload['attributes'],
                'media': row['media_refs'], 'localIssues': row['local_issues'],
                'localValidation': row['local_validation'], 'mediaReadiness': row['media_readiness'],
                'sourceCurrent': bool(current), 'readyToSubmit': False, 'limitations': limitations}}


def load(c, user, sku, snapshot_id=None):
    product = find(c, user, sku)
    if snapshot_id is None:
        row = c.execute('''SELECT * FROM amazon_publish_snapshots WHERE user_id=%s AND product_id=%s
            ORDER BY prepared_at DESC,id DESC LIMIT 1''', (user['id'], product['id'])).fetchone()
    else:
        row = c.execute('''SELECT * FROM amazon_publish_snapshots WHERE user_id=%s AND product_id=%s
            AND id=%s''', (user['id'], product['id'], snapshot_id)).fetchone()
    if not row:
        fail('amazon_snapshot_not_found', 'No hay una vista previa guardada para esta ficha.', 404)
    return present_snapshot(c, user, product, row)


class PrepareSnapshot(StrictBody):
    revision: int = Field(ge=1)


def routes(settings, database):
    router = APIRouter(prefix='/api/products')

    @router.post('/{sku}/amazon-publish-snapshots')
    def create(sku: str, body: PrepareSnapshot, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            return prepare(c, require_user(c, request), sku, body.revision)

    @router.get('/{sku}/amazon-publish-snapshots/latest')
    def latest(sku: str, request: Request):
        with database.connect() as c:
            return load(c, require_user(c, request), sku)

    @router.get('/{sku}/amazon-publish-snapshots/{snapshot_id}')
    def by_id(sku: str, snapshot_id: UUID, request: Request):
        with database.connect() as c:
            return load(c, require_user(c, request), sku, snapshot_id)

    return router
