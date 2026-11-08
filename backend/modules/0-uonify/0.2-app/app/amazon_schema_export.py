"""Exportación autorizada de referencia PTD; solo lectura, sin publicar ni editar listings."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from cryptography.fernet import Fernet
from .access import workspace_access
from .amazon_catalog import AmazonCatalog, AmazonReadError, MARKETPLACE
from .amazon_provider import load_config
from .database import Database
from .settings import load_settings


def export_reference(settings, email, asin, directory):
    output = Path(directory)
    output.mkdir(parents=True, exist_ok=False)
    with Database(settings.database).connect() as db:
        user = db.execute('SELECT * FROM users WHERE email=%s', (email,)).fetchone()
        if not user or workspace_access(db, user)['status'] != 'allowed':
            raise AmazonReadError('account_or_subscription_required')
        row = db.execute('SELECT seller_id,refresh_encrypted FROM amazon_connections WHERE user_id=%s',
                         (user['id'],)).fetchone()
        if not row:
            raise AmazonReadError('amazon_not_connected')
    client = AmazonCatalog(load_config(settings))
    refresh = Fernet(settings.encryption_key).decrypt(row['refresh_encrypted'].encode()).decode()
    client.authenticate(refresh)
    del refresh
    catalog = client.catalog_item(asin)
    types = {x['productType'] for x in catalog.get('productTypes', [])
             if x.get('marketplaceId') == MARKETPLACE and x.get('productType')}
    if len(types) != 1:
        raise AmazonReadError('ambiguous_or_missing_product_type')
    product_type = next(iter(types))
    (output / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    manifest = {'asin': asin, 'productType': product_type, 'marketplaceId': MARKETPLACE,
                'sellerId': row['seller_id'], 'locale': 'es_ES',
                'retrievedAt': datetime.now(timezone.utc).isoformat(),
                'requirementsEnforced': 'ENFORCED', 'requestedVersion': 'LATEST',
                'parentageLevel': 'not_specified', 'definitions': {},
                'notice': 'Referencia de tipo; no son los datos ni características de Uonify Basic.'}
    for requirements in ('LISTING', 'LISTING_PRODUCT_ONLY'):
        definition = client.definition(product_type, row['seller_id'], requirements)
        prefix = requirements.lower()
        checksums = {}
        for key, suffix in [('schema', 'schema'), ('metaSchema', 'metaschema')]:
            raw, info = client.download_schema(definition[key])
            name = prefix + '.' + suffix + '.json'
            (output / name).write_bytes(raw)
            checksums[key] = {**info, 'file': name}
            # Las URLs firmadas caducan y no deben quedar en artefactos ni logs.
            definition[key]['link']['resource'] = name
        (output / (prefix + '.definition.json')).write_text(json.dumps(definition, ensure_ascii=False, indent=2) + '\n')
        manifest['definitions'][requirements] = {'version': definition.get('productTypeVersion'), 'resources': checksums}
    manifest['requests'] = client.receipts
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return {'asin': asin, 'productType': product_type, 'marketplaceId': MARKETPLACE,
            'saved': str(output), 'checksumsVerified': True, 'requests': client.receipts}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--email', required=True)
    parser.add_argument('--asin', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        result = export_reference(load_settings(), args.email, args.asin, args.output)
    except AmazonReadError as error:
        print(json.dumps({'error': error.code, 'httpStatus': error.status}))
        return 1
    except Exception:
        # No imprimir repr/tracebacks de librerías que puedan contener secretos o enlaces firmados.
        print(json.dumps({'error': 'export_failed'}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
