"""PTD real, evaluación local y ficha persistente. Nunca publica ni escribe en Amazon."""
from datetime import datetime, timezone, timedelta
import hashlib
import json
import re
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from psycopg.types.json import Jsonb
from .amazon_provider import load_config
from .amazon_catalog import AmazonReadError, MARKETPLACE
from .amazon_listings_provider import AmazonListings, MARKETS
from .products import find, present, save, fail, require_access
from .product_requirements_fields import evaluate, apply
from .product_requirements_mapping import to_amazon, from_amazon
from .product_requirements_suggestions import add_suggestions


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


class ProductRequirements:
    def __init__(self, settings, database, config=None, client_factory=None):
        self.settings, self.database = settings, database
        self.config = config or load_config(settings)
        self.client_factory = client_factory or AmazonListings
        self.cipher = Fernet(settings.encryption_key)
        self.reasoning = None

    def _account(self, c, user):
        return c.execute('SELECT * FROM amazon_connections WHERE user_id=%s', (user['id'],)).fetchone()

    def _client(self, account):
        if not account:
            raise HTTPException(409, detail={'error': 'amazon_disconnected',
                'message': 'Conecta Amazon desde esta conversación para consultar sus requisitos.',
                'connectionActions': [{'provider': 'amazon', 'action': 'manage'}]})
        try:
            refresh = self.cipher.decrypt(account['refresh_encrypted'].encode()).decode()
        except (InvalidToken, ValueError):
            raise HTTPException(409, detail={'error': 'amazon_reconnect',
                'message': 'Vuelve a conectar Amazon para consultar los requisitos.',
                'connectionActions': [{'provider': 'amazon', 'action': 'manage'}]})
        client = self.client_factory(self.config)
        client.authenticate(refresh)
        return client

    def _snapshot(self, c, user, product):
        context = product.get('amazonRequirementsContext')
        if not context:
            return None
        return c.execute('''SELECT * FROM product_requirement_schemas WHERE user_id=%s AND product_id=%s
            AND seller_id=%s AND marketplace_id=%s''',
            (user['id'], product['id'], context['sellerId'], context['marketplaceId'])).fetchone()

    def get_for(self, c, user, sku, attribute=None):
        product = present(find(c, user, sku))
        snapshot = self._snapshot(c, user, product)
        account = self._account(c, user)
        base = {'state': 'unconfigured', 'evaluationId': None, 'productType': None,
                'marketplaceId': MARKETPLACE, 'referenceAsin': None, 'schemaVersion': None,
                'schemaChecksum': None, 'evaluatedAt': None, 'counts': {'missing': 0, 'invalid': 0, 'questions': 0},
                'fields': [], 'issues': [], 'attributes': [], 'localOnly': True,
                'message': 'Identifiquemos la categoría de tu producto para saber qué información pide Amazon.'}
        if not snapshot:
            return {'product': product, 'evaluation': base}
        metadata = snapshot['metadata']
        base.update(productType=snapshot['product_type'], marketplaceId=snapshot['marketplace_id'],
                    referenceAsin=snapshot['reference_asin'], schemaVersion=metadata.get('version'),
                    schemaChecksum=metadata['schemaHash'], evaluatedAt=datetime.now(timezone.utc).isoformat())
        if (not account or account['seller_id'] != snapshot['seller_id']
                or datetime.now(timezone.utc) - snapshot['fetched_at'] > timedelta(hours=24)):
            base.update(state='stale', message='Actualiza los requisitos con la cuenta Amazon conectada antes de continuar. Tu ficha se conserva.')
            return {'product': product, 'evaluation': base}
        attrs = product.get('amazonAttributes', {})
        plan = evaluate(snapshot['schema'], attrs, snapshot['marketplace_id'], attribute)
        add_suggestions(plan, product, snapshot['schema'])
        evaluation_id = digest({'revision': product['revision'], 'attributes': attrs, 'schema': metadata['schemaHash'],
                                'seller': snapshot['seller_id'], 'market': snapshot['marketplace_id'], 'attribute': attribute})
        base.update({key: plan[key] for key in ('fields', 'issues', 'counts', 'attributes')})
        base.update(evaluationId=evaluation_id, state='locally_valid' if plan['valid'] else 'needs_review' if plan['needsReview'] and not plan['fields'] else 'needs_input',
                    message='Los datos que pide Amazon están completos en esta revisión; aún no se ha enviado el producto.' if plan['valid']
                    else 'Solo faltan los datos que no hemos podido completar con tu información. Los revisaré después de cada respuesta.')
        if self.reasoning and not attribute:
            self.reasoning.decorate(c, user, product, snapshot, base)
        return {'product': product, 'evaluation': base}

    def prepare_for(self, c, user, sku, job=None, *, retry=False, acknowledge_unknown=False,
                    expected_reasoning_id=None):
        """Acción explícita de preparación; los GET siguen siendo de solo lectura."""
        require_access(c, user)
        current = self.get_for(c, user, sku)
        product = current['product']
        if current['evaluation']['state'] in ('unconfigured', 'stale'):
            if expected_reasoning_id:
                fail('reasoning_context_changed', 'La conexión o los requisitos cambiaron. Revisa el resumen antes de continuar.', 409)
            return current
        from .product_materials_amazon import latest_job, infer_attributes
        snapshot = self._snapshot(c, user, product)
        job = job if job is not None else latest_job(c, user, product)
        attrs, provenance, applied = infer_attributes(product, snapshot['schema'], snapshot['marketplace_id'], job,
                                                      schema_hash=snapshot['metadata']['schemaHash'])
        # No toca los atributos locales ya declarados ni marca fuentes como confirmadas.
        if expected_reasoning_id and applied:
            fail('reasoning_context_changed', 'Hay datos nuevos de tus materiales. Revisa la ficha antes de repetir la comprobación.', 409)
        if applied:
            product = save(c, user, {'revision': product['revision']}, sku, source='amazon-materials',
                amazon_state={'amazonAttributes': attrs, 'amazonRequirementsContext': product['amazonRequirementsContext'],
                              'amazonMaterialEvidence': provenance})
        needs_reasoning = not evaluate(snapshot['schema'], product.get('amazonAttributes', {}), snapshot['marketplace_id'], human=False)['valid']
        if expected_reasoning_id and (not self.reasoning or not needs_reasoning):
            fail('reasoning_context_changed', 'La ficha ya cambió. Revisa el resumen antes de volver a comprobarla.', 409)
        if self.reasoning and needs_reasoning:
            self.reasoning.enqueue(c, user, product, snapshot, job, retry=retry,
                                   acknowledge_unknown=acknowledge_unknown,
                                   expected_id=expected_reasoning_id)
        return self.get_for(c, user, sku)

    def configure_for(self, c, user, sku, revision, product_type=None, reference_asin=None, marketplace_id=MARKETPLACE):
        require_access(c, user)
        product = present(find(c, user, sku))
        if revision != product['revision']:
            fail('product_conflict', 'La ficha ha cambiado. Actualízala antes de continuar; tus datos se conservan.', 409)
        if marketplace_id not in MARKETS:
            fail('unsupported_marketplace', 'Selecciona un mercado europeo admitido.')
        if product_type and not re.fullmatch(r'[A-Z0-9_]{1,100}', product_type):
            fail('invalid_product_type', 'Indica el identificador de tipo de producto de Amazon, por ejemplo TABLETOP_GAME.')
        if reference_asin and not re.fullmatch(r'[A-Z0-9]{10}', reference_asin):
            fail('invalid_asin', 'Un ASIN contiene diez letras mayúsculas o números.')
        if not product_type and not reference_asin:
            fail('amazon_context_required', 'Indica el tipo de producto o un ASIN de referencia.')
        account = self._account(c, user)
        try:
            client = self._client(account)
            if reference_asin:
                item = client._get('/catalog/2022-04-01/items/' + reference_asin, {
                    'marketplaceIds': marketplace_id, 'includedData': 'productTypes', 'locale': 'es_ES'}, 'catalog_item')
                types = {item['productType'] for item in item.get('productTypes', [])
                         if item.get('marketplaceId') == marketplace_id and isinstance(item.get('productType'), str)}
                if len(types) != 1:
                    fail('amazon_product_type_unknown', 'El ASIN no identifica un único tipo de producto en este mercado. Indica su tipo explícitamente.', 409)
                resolved = next(iter(types))
                if product_type and resolved != product_type:
                    fail('amazon_product_type_mismatch', 'El ASIN corresponde a otro tipo de producto. Revisa la categoría elegida.', 409)
                product_type = resolved
            result = client.schema(account['seller_id'], marketplace_id, product_type)
        except AmazonReadError:
            fail('amazon_unavailable', 'No podemos recuperar los requisitos de Amazon ahora. Tu ficha se conserva; vuelve a intentarlo.', 503)
        schema = result['schema']
        if not isinstance(schema.get('properties'), dict):
            fail('unsupported_amazon_schema', 'Amazon ha devuelto una estructura que necesita revisión.', 409)
        # Valida soporte antes de guardar; todas las referencias se resuelven sin red.
        evaluate(schema, {}, marketplace_id)
        context = {'sellerId': account['seller_id'], 'marketplaceId': marketplace_id, 'productType': product_type}
        previous = product.get('amazonRequirementsContext')
        if previous and (previous['sellerId'] != context['sellerId'] or previous['productType'] != product_type):
            fail('amazon_context_conflict', 'La ficha ya tiene otro vendedor o tipo de producto. Conservamos sus atributos; revisa el cambio de contexto antes de sustituirlos.', 409)
        existing_scope = c.execute('''SELECT product_type FROM product_requirement_schemas WHERE user_id=%s AND product_id=%s
            AND seller_id=%s AND marketplace_id=%s''', (user['id'], product['id'], account['seller_id'], marketplace_id)).fetchone()
        attributes = product.get('amazonAttributes', {}) if previous == context or existing_scope else to_amazon(product, schema, product.get('amazonAttributes', {}), marketplace_id)
        local_patch = from_amazon(product, attributes, marketplace_id, set(attributes)) if existing_scope and previous != context else {}
        metadata = {'schemaHash': result['schemaHash'], 'version': result.get('definition', {}).get('version'),
                    'requirements': 'LISTING', 'requirementsEnforced': 'ENFORCED', 'locale': 'es_ES'}
        version = metadata['version']
        if isinstance(version, dict): metadata['version'] = version.get('version')
        c.execute('''INSERT INTO product_requirement_schemas(user_id,product_id,seller_id,marketplace_id,product_type,reference_asin,schema,metadata)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(user_id,product_id,seller_id,marketplace_id)
            DO UPDATE SET product_type=EXCLUDED.product_type,reference_asin=EXCLUDED.reference_asin,schema=EXCLUDED.schema,
            metadata=EXCLUDED.metadata,fetched_at=now()''',
            (user['id'], product['id'], account['seller_id'], marketplace_id, product_type, reference_asin, Jsonb(schema), Jsonb(metadata)))
        save(c, user, {**local_patch, 'revision': revision}, sku, source='amazon-requirements',
             amazon_state={'amazonAttributes': attributes, 'amazonRequirementsContext': context})
        return self.prepare_for(c, user, sku)

    def answer_for(self, c, user, sku, revision, evaluation_id, answers, attribute=None):
        current = self.get_for(c, user, sku, attribute)
        product, evaluation = current['product'], current['evaluation']
        if revision != product['revision'] or evaluation_id != evaluation['evaluationId'] or not evaluation_id:
            fail('product_conflict', 'Los requisitos o la ficha han cambiado. Actualiza las preguntas antes de guardar; tus respuestas se conservan.', 409)
        if evaluation['state'] in ('unconfigured', 'stale', 'reasoning'):
            fail('amazon_requirements_stale', 'Actualiza los requisitos de Amazon antes de guardar estas respuestas.', 409)
        snapshot = self._snapshot(c, user, product)
        attributes, touched = apply(snapshot['schema'], product.get('amazonAttributes', {}), snapshot['marketplace_id'], answers, attribute)
        patch = from_amazon(product, attributes, snapshot['marketplace_id'], touched)
        provenance = {path: {**item, 'active': False, 'supersededByUserRevision': revision + 1}
                      if json.loads(path)[0] in touched else item
                      for path, item in product.get('amazonMaterialEvidence', {}).items()}
        save(c, user, {**patch, 'revision': revision}, sku, source='amazon-requirements-answer',
             amazon_state={'amazonAttributes': attributes, 'amazonRequirementsContext': product['amazonRequirementsContext'],
                           'amazonMaterialEvidence': provenance})
        return self.prepare_for(c, user, sku)

    def get(self, user_id, sku, attribute=None):
        with self.database.connect() as c:
            return self.get_for(c, self._user(c, user_id), sku, attribute)

    def configure(self, user_id, sku, revision, product_type=None, reference_asin=None, marketplace_id=MARKETPLACE):
        with self.database.connect() as c:
            return self.configure_for(c, self._user(c, user_id), sku, revision, product_type, reference_asin, marketplace_id)

    def answer(self, user_id, sku, revision, evaluation_id, answers, attribute=None):
        with self.database.connect() as c:
            return self.answer_for(c, self._user(c, user_id), sku, revision, evaluation_id, answers, attribute)

    def _user(self, c, user_id):
        user = c.execute('SELECT * FROM users WHERE id=%s', (user_id,)).fetchone()
        if not user: fail('not_authenticated', 'Inicia sesión para continuar.', 401)
        return user
