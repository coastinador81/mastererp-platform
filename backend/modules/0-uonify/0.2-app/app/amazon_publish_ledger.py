"""AMZ-04: exact snapshot consent and a single durable Listings PUT reservation.

The public routes only record/read consent. There is deliberately no submission
route and the coordinator's gate defaults closed. A later approved chat flow
must provide verified media evidence and open that gate explicitly.
"""
from uuid import UUID, uuid4
import json

from fastapi import APIRouter, Request
from pydantic import Field
from psycopg.types.json import Jsonb

from .amazon_publish_snapshots import HASH, digest, present_snapshot
from .onboarding import StrictBody, require_user
from .products import fail, find, require_access
from .security import require_origin


def _current_user(c, user):
    active = c.execute('SELECT * FROM users WHERE id=%s FOR SHARE',
                       (user['id'],)).fetchone()
    if not active:
        fail('session_required', 'Vuelve a iniciar sesión para continuar.', 401)
    if active.get('deletion_requested_at'):
        fail('account_deletion_pending', 'La eliminación de la cuenta está pendiente.', 409)
    require_access(c, active)
    return active


def _locked_product(c, user, sku):
    found = find(c, user, sku)
    product = c.execute('''SELECT * FROM products WHERE user_id=%s AND id=%s
        AND deleted_at IS NULL FOR UPDATE''', (user['id'], found['id'])).fetchone()
    if not product:
        fail('product_not_found', 'No se encuentra este producto en tu cuenta.', 404)
    return product


def _current_snapshot(c, user, product, snapshot_id):
    row = c.execute('''SELECT * FROM amazon_publish_snapshots WHERE user_id=%s
        AND product_id=%s AND id=%s FOR SHARE''',
        (user['id'], product['id'], snapshot_id)).fetchone()
    if not row:
        fail('amazon_snapshot_not_found', 'No hay una vista previa guardada para esta ficha.', 404)
    c.execute('SELECT seller_id FROM amazon_connections WHERE user_id=%s FOR SHARE',
              (user['id'],)).fetchone()
    schema = c.execute('''SELECT product_type,metadata FROM product_requirement_schemas WHERE user_id=%s
        AND product_id=%s AND seller_id=%s AND marketplace_id=%s FOR SHARE''',
        (user['id'], product['id'], row['seller_id'], row['marketplace_id'])).fetchone()
    preview = present_snapshot(c, user, product, row)
    if (not preview['preview']['sourceCurrent'] or not schema
            or schema['metadata'].get('requirements') != 'LISTING'
            or schema['metadata'].get('requirementsEnforced') != 'ENFORCED'):
        fail('amazon_snapshot_stale',
             'La ficha, el vendedor o los requisitos de Amazon han cambiado. Prepara una nueva vista previa.', 409)
    return row, preview


def _approval_view(c, user, product, row):
    snapshot = c.execute('''SELECT * FROM amazon_publish_snapshots WHERE user_id=%s
        AND product_id=%s AND id=%s''',
        (user['id'], product['id'], row['snapshot_id'])).fetchone()
    if not snapshot:
        fail('amazon_approval_not_found', 'No se encuentra esta aprobación.', 404)
    preview = present_snapshot(c, user, product, snapshot)
    current = bool(preview['preview']['sourceCurrent'])
    return {'approvalId': str(row['id']), 'requestId': str(row['request_id']),
            'snapshotId': str(row['snapshot_id']), 'snapshotHash': row['snapshot_hash'],
            'payloadHash': row['payload_hash'], 'productRevision': row['product_revision'],
            'sku': row['sku'], 'sellerId': row['seller_id'],
            'marketplaceId': row['marketplace_id'], 'productType': row['product_type'],
            'schemaHash': row['schema_hash'], 'actorId': str(row['actor_id']),
            'approvedAt': row['approved_at'].isoformat(), 'sourceCurrent': current,
            'submissionReady': False,
            'notice': 'Se ha guardado la aprobación de esta revisión exacta. Aún no se ha enviado a Amazon.'}


def approve_exact(c, user, sku, request_id, snapshot_id, revision,
                  payload_hash, snapshot_hash, acknowledged):
    """Record a human's explicit exact-body acknowledgment, without sending."""
    user = _current_user(c, user)
    if not acknowledged:
        fail('amazon_approval_required', 'Confirma expresamente la revisión exacta antes de aprobarla.', 422)
    prior = c.execute('''SELECT * FROM amazon_publish_approvals
        WHERE user_id=%s AND request_id=%s''', (user['id'], request_id)).fetchone()
    if prior:
        if (prior['sku'] != sku or prior['snapshot_id'] != snapshot_id
                or prior['product_revision'] != revision or prior['payload_hash'] != payload_hash
                or prior['snapshot_hash'] != snapshot_hash):
            fail('amazon_approval_request_conflict',
                 'Este identificador ya corresponde a otra aprobación.', 409)
        product = c.execute('''SELECT * FROM products WHERE user_id=%s AND id=%s
            AND deleted_at IS NULL''', (user['id'], prior['product_id'])).fetchone()
        if not product:
            fail('product_not_found', 'No se encuentra este producto en tu cuenta.', 404)
        return _approval_view(c, user, product, prior)
    product = _locked_product(c, user, sku)
    prior = c.execute('''SELECT * FROM amazon_publish_approvals
        WHERE user_id=%s AND request_id=%s''', (user['id'], request_id)).fetchone()
    if prior:
        if (prior['product_id'] != product['id'] or prior['snapshot_id'] != snapshot_id
                or prior['product_revision'] != revision or prior['payload_hash'] != payload_hash
                or prior['snapshot_hash'] != snapshot_hash):
            fail('amazon_approval_request_conflict',
                 'Este identificador ya corresponde a otra aprobación.', 409)
        return _approval_view(c, user, product, prior)
    snapshot, preview = _current_snapshot(c, user, product, snapshot_id)
    if (snapshot['product_revision'] != revision or product['revision'] != revision
            or snapshot['payload_hash'] != payload_hash
            or snapshot['snapshot_hash'] != snapshot_hash):
        fail('amazon_approval_mismatch',
             'La aprobación no coincide con la revisión exacta que se está mostrando.', 409)
    if preview['preview']['localValidation'] != 'valid' or snapshot['local_issues']:
        fail('amazon_snapshot_needs_input',
             'Corrige las observaciones de la ficha antes de aprobar esta revisión.', 409)
    row = c.execute('''INSERT INTO amazon_publish_approvals
        (id,user_id,product_id,snapshot_id,request_id,actor_id,product_revision,sku,
         seller_id,marketplace_id,product_type,schema_hash,payload_hash,snapshot_hash)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT DO NOTHING RETURNING *''',
        (uuid4(), user['id'], product['id'], snapshot['id'], request_id, user['id'],
         revision, snapshot['sku'], snapshot['seller_id'], snapshot['marketplace_id'],
         snapshot['product_type'], snapshot['schema_hash'], payload_hash, snapshot_hash)).fetchone()
    if not row:
        prior = c.execute('''SELECT * FROM amazon_publish_approvals
            WHERE user_id=%s AND request_id=%s''', (user['id'], request_id)).fetchone()
        if not prior or prior['snapshot_id'] != snapshot_id:
            fail('amazon_approval_exists',
                 'Esta vista previa ya tiene una aprobación. Prepara otra revisión si necesitas cambios.', 409)
        row = prior
    return _approval_view(c, user, product, row)


def load_approval(c, user, sku, approval_id):
    user = _current_user(c, user)
    product = find(c, user, sku)
    row = c.execute('''SELECT * FROM amazon_publish_approvals WHERE user_id=%s
        AND product_id=%s AND id=%s''', (user['id'], product['id'], approval_id)).fetchone()
    if not row:
        fail('amazon_approval_not_found', 'No se encuentra esta aprobación.', 404)
    return _approval_view(c, user, product, row)


def _attempt_view(row):
    return {'attemptId': str(row['id']), 'approvalId': str(row['approval_id']),
            'requestId': str(row['request_id']), 'status': row['status'],
            'reservedAt': row['reserved_at'].isoformat(),
            'finishedAt': row['finished_at'].isoformat() if row['finished_at'] else None,
            'submissionId': row['submission_id'], 'requestReceipt': row['request_receipt'],
            'issues': row['issues'], 'errorCode': row['error_code'],
            'published': False}


def _validated_submission_snapshot(c, user, approval):
    """Keep product, seller, PTD and media proof locked while checking state."""
    product = _locked_product(c, user, approval['sku'])
    snapshot, preview = _current_snapshot(c, user, product, approval['snapshot_id'])
    if (snapshot['product_revision'] != approval['product_revision']
            or snapshot['sku'] != approval['sku']
            or snapshot['seller_id'] != approval['seller_id']
            or snapshot['marketplace_id'] != approval['marketplace_id']
            or snapshot['product_type'] != approval['product_type']
            or snapshot['schema_hash'] != approval['schema_hash']
            or snapshot['payload_hash'] != approval['payload_hash']
            or snapshot['snapshot_hash'] != approval['snapshot_hash']
            or preview['preview']['localValidation'] != 'valid'
            or snapshot['local_issues']):
        fail('amazon_approval_stale',
             'La ficha ya no coincide con la revisión aprobada. Revísala otra vez.', 409)
    refs = snapshot['media_refs']
    if (snapshot['media_readiness'] != 'unverified' or not refs
            or not any(ref['attribute'] == 'main_product_image_locator' for ref in refs)
            or any(ref['availability'] != 'unverified' for ref in refs)):
        fail('amazon_media_not_verified',
             'Antes de enviar necesitamos comprobar las imágenes de esta revisión.', 409)
    proof = c.execute('''SELECT * FROM amazon_publish_media_verifications WHERE user_id=%s
        AND snapshot_id=%s FOR SHARE''', (user['id'], snapshot['id'])).fetchone()
    if (not proof or proof['media_refs_hash'] != digest(refs)
            or proof['verified_at'] < snapshot['prepared_at']
            or proof['verification_method'] != 'asset_service'):
        fail('amazon_media_not_verified',
             'Antes de enviar necesitamos comprobar las imágenes de esta revisión.', 409)
    return snapshot


def reserve_once(c, user, approval_id, request_id, *, gate_open=False):
    """Reserve one attempt in a committed transaction before any network call.

    `gate_open` is false for every production caller today. The same approval
    cannot reserve a second attempt, even with a different requestId/worker.
    """
    user = _current_user(c, user)
    existing = c.execute('''SELECT * FROM amazon_publish_attempts
        WHERE user_id=%s AND request_id=%s''', (user['id'], request_id)).fetchone()
    if existing:
        if existing['approval_id'] != approval_id:
            fail('amazon_publish_request_conflict',
                 'Este identificador ya corresponde a otro envío.', 409)
        return _attempt_view(existing), False
    if not gate_open:
        fail('amazon_publish_disabled', 'El envío a Amazon aún no está habilitado.', 409)
    approval = c.execute('''SELECT * FROM amazon_publish_approvals WHERE user_id=%s
        AND id=%s''', (user['id'], approval_id)).fetchone()
    if not approval:
        fail('amazon_approval_not_found', 'No se encuentra esta aprobación.', 404)
    _validated_submission_snapshot(c, user, approval)
    existing = c.execute('''SELECT * FROM amazon_publish_attempts
        WHERE user_id=%s AND request_id=%s''', (user['id'], request_id)).fetchone()
    if existing:
        if existing['approval_id'] != approval_id:
            fail('amazon_publish_request_conflict',
                 'Este identificador ya corresponde a otro envío.', 409)
        return _attempt_view(existing), False
    row = c.execute('''INSERT INTO amazon_publish_attempts
        (id,user_id,approval_id,request_id,status)
        VALUES(%s,%s,%s,%s,'reserved') ON CONFLICT DO NOTHING RETURNING *''',
        (uuid4(), user['id'], approval_id, request_id)).fetchone()
    if not row:
        row = c.execute('''SELECT * FROM amazon_publish_attempts WHERE user_id=%s
            AND approval_id=%s''', (user['id'], approval_id)).fetchone()
        if row and row['request_id'] == request_id:
            return _attempt_view(row), False
        fail('amazon_approval_already_submitted',
             'Esta revisión ya tiene un intento de envío. Consulta su estado antes de continuar.', 409)
    return _attempt_view(row), True


def _finish(c, user_id, attempt_id, status, receipt=None):
    receipt = receipt or {}
    row = c.execute('''UPDATE amazon_publish_attempts SET status=%s,finished_at=now(),
        submission_id=%s,request_receipt=%s,issues=%s,error_code=%s
        WHERE user_id=%s AND id=%s AND status='reserved' RETURNING *''',
        (status, receipt.get('submissionId'), receipt.get('requestReceipt'),
         Jsonb(receipt.get('issues', [])), receipt.get('errorCode'), user_id, attempt_id)).fetchone()
    if not row:
        row = c.execute('''SELECT * FROM amazon_publish_attempts WHERE user_id=%s AND id=%s''',
                        (user_id, attempt_id)).fetchone()
    return _attempt_view(row)


def submit_once(database, user, approval_id, request_id, provider, *, gate_open=False):
    """Internal coordinator; no HTTP route or live provider is wired to it.

    The first transaction commits a reservation. On crash/timeout the approval
    is never sent again automatically; an operator must reconcile with Amazon.
    """
    with database.connect() as c:
        attempt, created = reserve_once(c, user, approval_id, request_id, gate_open=gate_open)
        if not created:
            return attempt
    try:
        with database.connect() as c:
            current_user = _current_user(c, user)
            approval = c.execute('''SELECT * FROM amazon_publish_approvals WHERE user_id=%s
                AND id=%s FOR SHARE''', (current_user['id'], approval_id)).fetchone()
            if not approval:
                fail('amazon_approval_not_found', 'No se encuentra esta aprobación.', 404)
            snapshot = _validated_submission_snapshot(c, current_user, approval)
            # These row locks remain held through the one PUT: editing the
            # product, switching seller or replacing the PTD cannot race it.
            receipt = provider.put(approval['seller_id'], approval['marketplace_id'],
                                   approval['sku'], snapshot['payload'])
            if (not isinstance(receipt, dict) or receipt.get('status') not in ('ACCEPTED', 'INVALID')
                    or not isinstance(receipt.get('issues'), list)
                    or not isinstance(receipt.get('submissionId'), str)
                    or not receipt['submissionId']
                    or len(json.dumps(receipt['issues'], ensure_ascii=False)) > 64000
                    or any(not isinstance(receipt.get(key), (str, type(None)))
                           or len(receipt.get(key) or '') > 300
                           for key in ('submissionId', 'requestReceipt'))):
                raise ValueError('ambiguous_receipt')
            status = 'accepted_initial' if receipt['status'] == 'ACCEPTED' else 'invalid'
            saved = {'submissionId': receipt.get('submissionId'),
                     'requestReceipt': receipt.get('requestReceipt'), 'issues': receipt['issues']}
            return _finish(c, user['id'], UUID(attempt['attemptId']), status, saved)
    except Exception:
        # This includes a preflight changed after reservation. It is safe to
        # call unknown rather than risk a second PUT after a lost response.
        with database.connect() as c:
            return _finish(c, user['id'], UUID(attempt['attemptId']), 'unknown',
                           {'errorCode': 'submission_outcome_unknown'})


def expire_abandoned_reservations(c, *, older_than_seconds=120):
    """Mark abandoned reservations unknown; never queue another PUT."""
    rows = c.execute('''UPDATE amazon_publish_attempts
        SET status='unknown',finished_at=now(),error_code='submission_outcome_unknown'
        WHERE status='reserved' AND reserved_at < now()-(%s * interval '1 second')
        RETURNING id''', (older_than_seconds,)).fetchall()
    return len(rows)


class ApproveExactSnapshot(StrictBody):
    requestId: UUID = Field(strict=False)
    snapshotId: UUID = Field(strict=False)
    productRevision: int = Field(ge=1)
    payloadHash: str = Field(pattern=HASH.pattern)
    snapshotHash: str = Field(pattern=HASH.pattern)
    acknowledgeExactSnapshot: bool


def routes(settings, database):
    router = APIRouter(prefix='/api/products')

    @router.post('/{sku}/amazon-publish-approvals')
    def create(sku: str, body: ApproveExactSnapshot, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            user = require_user(c, request)
            return approve_exact(c, user, sku, body.requestId, body.snapshotId,
                                 body.productRevision, body.payloadHash, body.snapshotHash,
                                 body.acknowledgeExactSnapshot)

    @router.get('/{sku}/amazon-publish-approvals/{approval_id}')
    def by_id(sku: str, approval_id: UUID, request: Request):
        with database.connect() as c:
            return load_approval(c, require_user(c, request), sku, approval_id)

    return router
