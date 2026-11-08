"""Owner-bound approval of a local product change proposed by Uony.

The model can only create a proposal. A separate, typed customer action applies
the exact payload once. This ledger never authorizes Drive analysis or Amazon.
"""
from hashlib import sha256
import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Query, Request
from pydantic import Field
from psycopg.types.json import Jsonb

from .onboarding import StrictBody, require_user
from .product_memory import bind
from .products import fail, find, require_access, save
from .security import require_origin


def _digest(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(',', ':'), allow_nan=False).encode()
    return sha256(encoded).hexdigest()


def _content(row):
    return {'action': row['action'], 'sku': row['target_sku'],
            'targetProductId': str(row['target_product_id']) if row['target_product_id'] else None,
            'baseRevision': row['base_revision'],
            'threadLinkVersion': row['thread_link_version'],
            'focusCutoffAt': row['focus_cutoff_at'].isoformat() if row['focus_cutoff_at'] else None,
            'payload': row['payload']}


def _view(row):
    return {'proposalId': str(row['origin_request_id']), 'threadId': row['thread_id'],
            'action': row['action'], 'targetSku': row['target_sku'],
            'targetProductId': str(row['target_product_id']) if row['target_product_id'] else None,
            'baseRevision': row['base_revision'], 'payload': row['payload'],
            'threadLinkVersion': row['thread_link_version'],
            'proposalHash': row['proposal_hash'], 'status': row['status'],
            'createdAt': row['created_at'].isoformat(),
            'decision': row['decision_result']}


def prepare(c, user, thread_id, request_id, pending):
    """Record the exact proposal in the successful model turn; never save a product."""
    if not pending:
        return None
    require_access(c, user)
    source = c.execute('''SELECT r.status,r.project_id,t.product_history_cutoff_at FROM uony_requests r
        JOIN uony_threads t ON t.user_id=r.user_id AND t.id=r.thread_id
        WHERE r.user_id=%s AND r.request_id=%s AND r.thread_id=%s
        AND t.deleted_at IS NULL''', (user['id'], request_id, thread_id)).fetchone()
    if not source or source['status'] != 'running':
        fail('product_proposal_source_changed',
             'La conversación ha cambiado. Pide a Uony preparar otra propuesta.', 409)
    action = 'create' if pending['sku'] is None else 'update'
    payload = pending['data']
    sku = payload['sku'] if action == 'create' else pending['sku']
    target_product_id = pending.get('productId') if action == 'update' else None
    base_revision = None if action == 'create' else payload['revision']
    if action == 'update':
        current = find(c, user, sku)
        if str(current['id']) != target_product_id or current['revision'] != base_revision:
            fail('product_conflict',
                 'La ficha cambió mientras Uony preparaba esta propuesta. Revísala de nuevo.', 409)
    link = c.execute('''SELECT version,google_subject FROM uony_thread_products
        WHERE user_id=%s AND thread_id=%s''', (user['id'], thread_id)).fetchone()
    if link and link['google_subject'] != user['google_subject']:
        fail('account_changed', 'Esta conversación pertenece a otra identidad de Google.', 409)
    link_version = link['version'] if link else 0
    content = {'action': action, 'sku': sku,
               'targetProductId': target_product_id,
               'baseRevision': base_revision, 'threadLinkVersion': link_version,
               'focusCutoffAt': source['product_history_cutoff_at'].isoformat()
                   if source['product_history_cutoff_at'] else None,
               'payload': payload}
    fingerprint = _digest(content)
    row = c.execute('''INSERT INTO uony_product_proposals
        (user_id,origin_request_id,thread_id,google_subject,google_project_id,
         action,target_sku,target_product_id,base_revision,thread_link_version,focus_cutoff_at,
         payload,proposal_hash)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT(user_id,origin_request_id) DO NOTHING RETURNING *''',
        (user['id'], request_id, thread_id, user['google_subject'], source['project_id'],
         action, sku, target_product_id, base_revision, link_version,
         source['product_history_cutoff_at'],
         Jsonb(payload), fingerprint)).fetchone()
    if row is None:
        row = c.execute('''SELECT * FROM uony_product_proposals
            WHERE user_id=%s AND origin_request_id=%s''',
            (user['id'], request_id)).fetchone()
        if (not row or row['thread_id'] != thread_id or row['google_subject'] != user['google_subject']
                or row['google_project_id'] != source['project_id']
                or row['proposal_hash'] != fingerprint or row['status'] != 'pending'):
            fail('product_proposal_conflict',
                 'Este intento ya corresponde a otra propuesta. Revisa la conversación.', 409)
    return _view(row)


def _owned(c, user, thread_id, proposal_id, *, lock=False):
    # Keep the thread cutoff fixed through save/bind. A concurrent product
    # deletion can otherwise erase the link and reset its apparent version.
    row = c.execute('''SELECT p.*,t.product_history_cutoff_at AS current_focus_cutoff_at
        FROM uony_product_proposals p
        JOIN uony_threads t ON t.user_id=p.user_id AND t.id=p.thread_id
        WHERE p.user_id=%s AND p.origin_request_id=%s AND p.thread_id=%s
        AND p.google_subject=%s AND t.deleted_at IS NULL'''
        + (' FOR UPDATE OF p FOR SHARE OF t' if lock else ''),
        (user['id'], proposal_id, thread_id, user['google_subject'])).fetchone()
    if not row:
        fail('product_proposal_not_found',
             'No encontramos esta propuesta en tu conversación.', 404)
    return row


class ProductDecision(StrictBody):
    threadId: str = Field(min_length=1, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')
    requestId: UUID = Field(strict=False)
    proposalHash: str = Field(pattern=r'^[a-f0-9]{64}$')
    baseRevision: int | None = Field(default=None, ge=1)
    action: Literal['approve', 'reject', 'cancel']


def decide(c, user, proposal_id, body):
    reused = c.execute('''SELECT origin_request_id FROM uony_product_proposals
        WHERE user_id=%s AND decision_request_id=%s''',
        (user['id'], body.requestId)).fetchone()
    if reused and reused['origin_request_id'] != proposal_id:
        fail('product_decision_request_conflict',
             'Esta confirmación ya corresponde a otra propuesta.', 409)
    row = _owned(c, user, body.threadId, proposal_id, lock=True)
    if (row['proposal_hash'] != body.proposalHash
            or row['base_revision'] != body.baseRevision
            or _digest(_content(row)) != row['proposal_hash']):
        fail('product_proposal_changed',
             'La propuesta no coincide con lo que has revisado. Actualízala antes de decidir.', 409)
    wanted_status = {'approve': 'approved', 'reject': 'rejected',
                     'cancel': 'cancelled'}[body.action]
    if row['status'] != 'pending':
        if row['status'] == wanted_status and row['decision_request_id'] == body.requestId:
            # This is only a receipt for an action that already committed. It
            # remains replayable if access or project changed after that commit.
            return row['decision_result']
        fail('product_proposal_decided',
             'Esta propuesta ya tiene una decisión. Consulta su estado actual.', 409)
    product = None
    link = None
    if body.action == 'approve':
        # Product deletion erases the link row and can reset its apparent version
        # to zero. The thread cutoff survives that unlink and fences old proposals.
        if row['current_focus_cutoff_at'] != row['focus_cutoff_at']:
            fail('product_link_conflict',
                 'Esta conversación cambió de producto. Revisa una propuesta nueva.', 409)
        require_access(c, user)
        connection = c.execute('''SELECT project_id FROM google_cloud_connections
            WHERE user_id=%s AND google_subject=%s AND status='connected' ''',
            (user['id'], user['google_subject'])).fetchone()
        if not connection or connection['project_id'] != row['google_project_id']:
            fail('google_changed',
                 'La conexión o el proyecto de Google cambió. Pide una propuesta nueva antes de guardar.', 409)
        if row['action'] == 'update':
            current = c.execute('''SELECT id,revision FROM products
                WHERE user_id=%s AND lower(sku)=lower(%s) AND deleted_at IS NULL
                FOR UPDATE''', (user['id'], row['target_sku'])).fetchone()
            if (not current or current['id'] != row['target_product_id']
                    or current['revision'] != row['base_revision']):
                fail('product_conflict',
                     'La ficha ha cambiado. Revisa la nueva versión antes de aprobar la edición.', 409)
        product = save(c, user, row['payload'],
                       None if row['action'] == 'create' else row['target_sku'],
                       source='uony-approved')
        if product['sku'] != row['target_sku']:
            fail('product_proposal_changed',
                 'La ficha guardada no coincide con la propuesta aprobada.', 409)
        # The same explicit approval also makes the saved product available to
        # the next turn in this thread. If its focus changed, roll back save.
        latest = find(c, user, product['sku'])
        link = bind(c, user, row['thread_id'], latest, 'approval',
                    row['thread_link_version'])
    result = {'proposalId': str(proposal_id), 'requestId': str(body.requestId),
              'status': wanted_status, 'linkedProduct': link,
              'productChanges': ([{'product': product,
                  'previousSku': None if row['action'] == 'create' else row['target_sku']}]
                  if product else [])}
    updated = c.execute('''UPDATE uony_product_proposals SET status=%s,
        decision_request_id=%s,decision_at=now(),decision_result=%s
        WHERE user_id=%s AND origin_request_id=%s AND status='pending' RETURNING *''',
        (wanted_status, body.requestId, Jsonb(result), user['id'], proposal_id)).fetchone()
    if not updated:
        fail('product_proposal_decided',
             'Esta propuesta ya tiene una decisión. Consulta su estado actual.', 409)
    c.execute('''UPDATE uony_requests SET product_proposal=%s
        WHERE user_id=%s AND request_id=%s''',
        (Jsonb(_view(updated)), user['id'], proposal_id))
    return result


def routes(settings, database):
    router = APIRouter(prefix='/product-proposals')

    @router.get('/{proposal_id}')
    def read(proposal_id: UUID, request: Request, threadId: str = Query(
            min_length=1, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')):
        with database.connect() as c:
            return _view(_owned(c, require_user(c, request), threadId, proposal_id))

    @router.post('/{proposal_id}/decision')
    def decision(proposal_id: UUID, body: ProductDecision, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            return decide(c, require_user(c, request), proposal_id, body)

    return router
