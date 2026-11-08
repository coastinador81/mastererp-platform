"""Product memory is a scoped, read-time view of authoritative saved rows."""
from typing import Literal
from pydantic import Field
from psycopg.types.json import Jsonb
from .onboarding import StrictBody
from .products import fail, find
from .product_materials_amazon import eligible_job
from .product_materials_review import current_value, custom_id, equivalent, field_of, standard_target

MAX_FACTS = 24
MAX_VALUE = 320
LINK_DECLARATION = {'name': 'link_product_to_thread',
    'description': ('Vincula un borrador existente a esta conversación cuando el cliente quiera seguir trabajando con esa ficha, lo diga como lo diga; no si solo pregunta por ella. '
                    'Antes busca por el nombre o SKU mencionado con list_products y lee la ficha con get_product. '
                    'Si hay varias coincidencias, pregunta cuál; nunca elijas la primera. No edita la ficha ni analiza archivos.'),
    'parameters': {'type': 'OBJECT', 'properties': {
        'sku': {'type': 'STRING'}, 'revision': {'type': 'INTEGER'}}, 'required': ['sku', 'revision']}}


class ProductAction(StrictBody):
    action: Literal['link']
    sku: str = Field(min_length=1, max_length=80)
    revision: int = Field(ge=1)
    expectedVersion: int = Field(default=0, ge=0)


def _thread(connection, user, thread_id):
    row = connection.execute('SELECT deleted_at FROM uony_threads WHERE user_id=%s AND id=%s',
                             (user['id'], thread_id)).fetchone()
    if not row:
        fail('thread_not_found', 'No encontramos esta conversación en tu cuenta.', 404)
    if row['deleted_at']:
        fail('thread_deleted', 'Esta conversación se ha eliminado. Abre una nueva para continuar.', 410)


def bind(connection, user, thread_id, product, source, expected_version=None):
    """A typed chat action or an explicit intake confirmation may change the link."""
    _thread(connection, user, thread_id)
    if source not in ('conversation', 'intake', 'approval'):
        raise ValueError('Invalid link source')
    if product['user_id'] != user['id'] or product.get('deleted_at'):
        fail('product_not_found', 'No se encuentra este producto en tu cuenta.', 404)
    saved = connection.execute('''SELECT * FROM uony_thread_products
        WHERE user_id=%s AND thread_id=%s FOR UPDATE''', (user['id'], thread_id)).fetchone()
    version = saved['version'] if saved else 0
    if expected_version is not None and version != expected_version:
        fail('product_link_conflict', 'Esta conversación ya cambió de producto. Actualiza su estado antes de elegir otra ficha.', 409)
    if saved and saved['google_subject'] != user['google_subject']:
        fail('account_changed', 'La identidad de esta conversación ha cambiado. Abre una nueva.', 409)
    if source in ('conversation', 'approval'):
        # Choosing a concrete saved product ends an earlier, unfinished folder
        # selection. Old intake cards must not create a second product later.
        connection.execute('''DELETE FROM uony_product_intakes
            WHERE user_id=%s AND thread_id=%s AND status IN ('selecting','identified')''',
            (user['id'], thread_id))
    if saved and saved['product_id'] == product['id']:
        return {'sku': product['sku'], 'revision': product['revision'], 'version': version}
    if saved:
        row = connection.execute('''UPDATE uony_thread_products SET product_id=%s,google_subject=%s,
            linked_revision=%s,source=%s,version=version+1,updated_at=now()
            WHERE user_id=%s AND thread_id=%s RETURNING version''',
            (product['id'], user['google_subject'], product['revision'], source, user['id'], thread_id)).fetchone()
        version = row['version']
    else:
        connection.execute('''INSERT INTO uony_thread_products
            (user_id,thread_id,product_id,google_subject,linked_revision,source)
            VALUES(%s,%s,%s,%s,%s,%s)''',
            (user['id'], thread_id, product['id'], user['google_subject'], product['revision'], source))
        version = 1
    return {'sku': product['sku'], 'revision': product['revision'], 'version': version}


def execute_action(connection, user, body):
    if body.productContext or any((body.formResponse, body.incidentAction, body.materialAction, body.requirementsAction)):
        fail('invalid_action', 'Elige un producto en una acción separada de las demás.', 422)
    action = body.productAction
    product = find(connection, user, action.sku)
    if product['revision'] != action.revision:
        fail('product_conflict', 'La ficha ha cambiado. Actualiza sus datos antes de vincularla.', 409)
    bind(connection, user, body.threadId, product, 'conversation', action.expectedVersion)
    reply = f"Continuaremos con {product['data']['name']}. Consultaré la revisión actual y los datos confirmados de esta ficha cuando los necesitemos."
    connection.execute('''INSERT INTO uony_requests
        (user_id,request_id,thread_id,prompt,reply,status,model,project_id,
         requested_model,effort,selection_reason,product_action,usage)
        VALUES(%s,%s,%s,%s,%s,'success','uonify-guide','uonify-guide',%s,%s,%s,%s,%s)''',
        (user['id'], body.requestId, body.threadId, body.text, reply, body.model, body.effort,
         'Vinculación explícita del producto en la conversación', Jsonb(action.model_dump()),
         Jsonb({'calls': 0, 'totalTokenCount': 0})))
    return {'reply': reply, 'model': 'uonify-guide', 'effort': body.effort,
            'selectionReason': 'Vinculación explícita del producto en la conversación',
            'productChanges': [], 'connectionActions': [], 'conversationForm': None}


class ProductLinkTools:
    """Prepare only; bind in the same transaction as the successful response."""
    def __init__(self, database, user, thread_id, text):
        self.database, self.user, self.thread_id, self.text = database, user, thread_id, text
        self.prepared = None
        self.result = None

    def prepare(self, args, reads, search):
        if not self.thread_id or not isinstance(args, dict) or set(args) != {'sku', 'revision'}:
            return {'error': 'invalid_tool', 'message': 'Indica una ficha concreta de esta conversación.'}
        sku, revision = args['sku'], args['revision']
        if not isinstance(sku, str) or type(revision) is not int or revision < 1:
            return {'error': 'invalid_tool', 'message': 'Indica el SKU y la revisión leída.'}
        # Lote 6 (A7): whether the customer wants to resume is the model's to
        # understand; the server keeps provenance (the search uses the customer's
        # words), the current revision, one match and the idempotent bind.
        if not search or not search['query'] or search['query'].casefold() not in self.text.casefold() or search['hasMore']:
            return {'error': 'bounded_search_required', 'message': 'Busca primero el nombre o SKU mencionado por el cliente.'}
        if len(search['products']) != 1 or search['products'][0]['sku'].casefold() != sku.casefold():
            return {'error': 'product_ambiguous', 'message': 'Hay varias fichas posibles. Pregunta cuál quiere continuar.'}
        if reads.get(search['products'][0]['sku']) != revision:
            return {'error': 'read_required', 'message': 'Lee la revisión vigente de esta ficha antes de vincularla.'}
        if self.prepared:
            if (self.prepared['sku'], self.prepared['revision']) != (search['products'][0]['sku'], revision):
                return {'error': 'one_selection', 'message': 'Elige una sola ficha por mensaje.'}
            return {'prepared': True, 'sku': self.prepared['sku']}
        with self.database.connect() as connection:
            current = connection.execute('''SELECT version,google_subject FROM uony_thread_products
                WHERE user_id=%s AND thread_id=%s''', (self.user['id'], self.thread_id)).fetchone()
        if current and current['google_subject'] != self.user['google_subject']:
            return {'error': 'account_changed', 'message': 'Esta conversación pertenece a otra identidad de Google.'}
        self.prepared = {'sku': search['products'][0]['sku'], 'revision': revision,
                         'expectedVersion': current['version'] if current else 0}
        return {'prepared': True, 'sku': self.prepared['sku'],
                'message': 'La ficha se vinculará a este hilo cuando la respuesta se guarde; aún no se ha cambiado.'}

    def commit(self, connection, user):
        if not self.prepared:
            return None
        product = find(connection, user, self.prepared['sku'])
        if product['revision'] != self.prepared['revision']:
            fail('product_conflict', 'La ficha cambió mientras Uony respondía. Actualízala antes de continuar.', 409)
        self.result = bind(connection, user, self.thread_id, product, 'conversation',
                           self.prepared['expectedVersion'])
        self.result['name'] = product['data']['name']
        return self.result


def _source_refs(proposal, versions):
    refs = []
    for citation in proposal.get('evidence') or []:
        if not isinstance(citation, dict):
            continue
        source_id, version = citation.get('sourceId'), citation.get('sourceVersion')
        if not isinstance(source_id, str) or not isinstance(version, str) or versions.get(source_id) != version:
            continue
        refs.append({'sourceId': source_id, 'version': version,
                     'locator': str(citation.get('locator', ''))[:120]})
        if len(refs) == 2:
            break
    return refs


def _text(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    result = str(value).strip()
    return result if result and len(result) <= MAX_VALUE else None


def project(connection, user, thread_id):
    """Read the explicitly linked saved product under a lock until commit.

    A worker's final memory check and saved reply must precede any later edit
    of this product; otherwise a confirmed fact can change between them.
    """
    if not thread_id:
        return None
    row = connection.execute('''SELECT b.version,b.linked_revision,b.source,
        p.id AS product_id,p.sku,p.revision,p.data,p.deleted_at
        FROM uony_thread_products b
        JOIN uony_threads t ON t.user_id=b.user_id AND t.id=b.thread_id
        JOIN products p ON p.user_id=b.user_id AND p.id=b.product_id
        WHERE b.user_id=%s AND b.thread_id=%s AND b.google_subject=%s AND t.deleted_at IS NULL
        FOR SHARE OF p''',
        (user['id'], thread_id, user['google_subject'])).fetchone()
    if not row or row['deleted_at']:
        return None
    product = row['data']
    result = {'product': {'sku': row['sku'], 'name': product.get('name', ''),
                          'revision': row['revision'], 'linkVersion': row['version']},
              'savedFields': {}, 'confirmedFacts': [], 'materialState': 'none',
              'notice': 'Datos guardados de este producto; las fuentes externas no se comprueban en tiempo real.'}
    for key in ('brand', 'category', 'price'):
        value = _text(product.get(key))
        if value is not None:
            result['savedFields'][key] = value
    # Preserve the complete material snapshot through the caller's commit.
    # Writers lock product -> job -> sources; use the same order here so a
    # source refresh cannot overtake the final conversation-memory check.
    material_scope = '''j.user_id=%s AND j.google_subject=%s AND
        (j.product_id=%s OR EXISTS (SELECT 1 FROM uony_product_intakes AS i
            WHERE i.user_id=j.user_id AND i.id=j.intake_id
                AND i.google_subject=j.google_subject AND i.product_id=%s
                AND i.status='linked' AND i.folder_id=j.folder_id))'''
    material_params = (user['id'], user['google_subject'], row['product_id'], row['product_id'])
    job = connection.execute('''SELECT j.id,j.status,j.result FROM product_material_jobs AS j
        WHERE ''' + material_scope + '''
        ORDER BY j.created_at DESC,j.id DESC LIMIT 1 FOR SHARE OF j''',
        material_params).fetchone()
    decision_job = connection.execute('''SELECT j.id,j.status,j.result FROM product_material_jobs AS j
        WHERE ''' + material_scope + ''' AND j.status='ready'
          AND j.result->'facts'->>'version'='1'
        ORDER BY j.created_at DESC,j.id DESC LIMIT 1 FOR SHARE OF j''',
        material_params).fetchone()
    drive = connection.execute('''SELECT status,google_subject FROM google_drive_connections
        WHERE user_id=%s''', (user['id'],)).fetchone()
    drive_ready = bool(drive and drive['status'] == 'connected' and
                       drive['google_subject'] == user['google_subject'])
    payload = decision_job['result'] if decision_job and isinstance(decision_job['result'], dict) else {}
    facts = payload.get('facts') if isinstance(payload.get('facts'), dict) else {}
    material = {**payload, 'facts': facts, 'status': decision_job['status']} if decision_job else None
    if material:
        for key in ('resolution', 'error', 'reconciliation'):
            if not isinstance(material.get(key), dict):
                material[key] = {}
    usable = bool(job and decision_job and job['id'] == decision_job['id'] and
                  drive_ready and eligible_job(material))
    if job:
        result['materialState'] = ('permission_required' if not drive_ready else
                                   'analysis_pending' if job['status'] in ('queued', 'running') else
                                   'saved_sources' if usable else 'review_required')
    versions = {}
    proposals = []
    stored_proposals = facts.get('proposals')
    confirmed = [item for item in stored_proposals if
                 isinstance(item, dict) and item.get('status') == 'confirmed'
                 and all(isinstance(item.get(key), str) for key in ('field', 'label', 'value'))
                 and not item.get('supersededByRefresh') and not item.get('observationIssue')
                 and item.get('scope', 'product') == 'product'
                 and item.get('channel', 'product') in ('product', 'safety')
                 ] if decision_job and facts.get('version') == 1 and isinstance(stored_proposals, list) else []
    if usable:
        source_rows = connection.execute('''SELECT source_id,version FROM product_material_sources
            WHERE job_id=%s ORDER BY source_id FOR SHARE''', (decision_job['id'],)).fetchall()
        versions = {source['source_id']: source['version'] for source in source_rows}
        proposals = confirmed
        if not versions or any(not isinstance(citation.get('sourceId'), str) or
               citation.get('sourceId') not in versions or
               citation.get('sourceVersion') != versions[citation['sourceId']]
               for item in proposals for citation in (item.get('evidence') or [])
               if isinstance(citation, dict)):
            result['materialState'] = 'review_required'
            proposals = []
            usable = False
    if not proposals:
        # A newer job can be pending or Drive can be revoked. Previous reviewed
        # standard decisions remain visible only when the saved value still matches;
        # without current source versions they are explicitly marked unverified.
        proposals = [item for item in confirmed if standard_target(item)]
    by_id = {}
    for proposal in proposals:
        if standard_target(proposal):
            continue
        value = _text(proposal.get('confirmedValue'))
        if value is None or not equivalent(current_value(product, proposal, confirmed_only=True), value):
            continue
        refs = _source_refs(proposal, versions) if proposal.get('supportStatus') == 'supported' else []
        if refs:
            by_id[custom_id(proposal)] = refs
    for item in product.get('customFields') or []:
        if not isinstance(item, dict) or item.get('isConfirmed') is not True:
            continue
        value = _text(item.get('value'))
        if value is None:
            continue
        refs = by_id.get(item.get('id'), [])
        source = str(item.get('source') or 'Ficha confirmada')[:120]
        result['confirmedFacts'].append({'id': str(item.get('id') or '')[:100],
            'label': str(item.get('name') or '')[:120], 'value': value,
            'sourceLabel': source, 'sourceRefs': refs,
            'freshness': 'saved_source_version' if refs else 'source_not_rechecked'
            if not source.casefold().startswith(('cliente', 'usuario')) else 'saved_product_revision'})
        if len(result['confirmedFacts']) >= MAX_FACTS:
            break
    if len(result['confirmedFacts']) < MAX_FACTS:
        for proposal in proposals:
            if not standard_target(proposal):
                continue
            value = _text(proposal.get('confirmedValue'))
            if value is None or not equivalent(current_value(product, proposal, confirmed_only=True), value):
                continue
            refs = _source_refs(proposal, versions) if proposal.get('supportStatus') == 'supported' else []
            if not refs and proposal.get('confirmationOrigin') != 'user_declared' and usable:
                continue
            user_declared = not refs and proposal.get('confirmationOrigin') == 'user_declared'
            result['confirmedFacts'].append({'id': str(proposal.get('id') or '')[:100],
                'label': str(proposal.get('label') or field_of(proposal))[:120],
                'value': value, 'sourceLabel': 'Cliente · dato confirmado' if user_declared
                else 'Drive · decisión revisada', 'sourceRefs': refs,
                'freshness': 'saved_product_revision' if user_declared else
                'saved_source_version' if refs else 'source_not_rechecked'})
            if len(result['confirmedFacts']) >= MAX_FACTS:
                break
    return result
