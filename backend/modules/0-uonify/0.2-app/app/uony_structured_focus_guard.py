"""Keep typed chat actions on the explicitly selected customer goal."""
from fastapi import HTTPException

from .products import find
from .uony_assignments import _assignment, _linked_product


def _conflict():
    raise HTTPException(409, detail={'error': 'assignment_focus_conflict',
        'message': 'Esta acción corresponde a otra ficha o pregunta. Revisa qué encargo quieres continuar.'})


def _incident_product(c, user, incident_id):
    row = c.execute('''SELECT sku,product_id FROM amazon_incidents
        WHERE user_id=%s AND id=%s''', (user['id'], incident_id)).fetchone()
    if not row:
        _conflict()
    return row


def check_target(c, user, body, focus_id):
    """Return a product ID to claim only after an explicit successful link."""
    if focus_id is None:
        return None
    assignment = _assignment(c, user, focus_id)
    linked = _linked_product(c, user, assignment)
    unrelated_intake = c.execute('''SELECT EXISTS (
        SELECT 1 FROM uony_product_intakes
        WHERE user_id=%s AND thread_id=%s AND google_subject=%s
        AND status IN ('selecting','identified')
        AND id IS DISTINCT FROM %s) AS present''',
        (user['id'], body.threadId, user['google_subject'],
         assignment['intake_id'])).fetchone()['present']
    if unrelated_intake:
        _conflict()

    def same_product(sku, product_id=None):
        if not linked or not isinstance(sku, str) or sku.casefold() != linked['sku'].casefold():
            _conflict()
        if product_id is not None and product_id != linked['id']:
            _conflict()

    if body.productContext:
        same_product(body.productContext.sku)
    if body.productAction:
        target = find(c, user, body.productAction.sku)
        if linked:
            same_product(target['sku'], target['id'])
            return None
        if assignment['product_id'] or assignment['intake_id']:
            _conflict()
        return target['id']
    if body.materialAction:
        same_product(body.materialAction.sku)
    if body.requirementsAction:
        same_product(body.requirementsAction.sku)
    if body.incidentAction:
        incident = _incident_product(c, user, body.incidentAction.incidentId)
        same_product(incident['sku'], incident['product_id'])
    if body.formResponse:
        saved = c.execute('''SELECT r.created_at,r.conversation_form,f.updated_at AS focused_at
            FROM uony_requests AS r JOIN uony_assignment_focus AS f
            ON f.user_id=r.user_id AND f.thread_id=r.thread_id
            WHERE r.user_id=%s AND r.thread_id=%s AND r.request_id=%s
            AND r.status='success' AND f.assignment_id=%s
            AND f.google_subject=%s''',
            (user['id'], body.threadId, body.formResponse.formId,
             focus_id, user['google_subject'])).fetchone()
        if not saved or saved['created_at'] < saved['focused_at']:
            _conflict()
        form = saved['conversation_form']
        context = form.get('context') if isinstance(form, dict) else None
        if not isinstance(context, dict):
            _conflict()
        if context.get('kind') in ('product_guide', 'drive_analysis'):
            same_product(context.get('sku'))
        elif context.get('kind') == 'product_incident':
            incident = _incident_product(c, user, context.get('incidentId'))
            same_product(incident['sku'], incident['product_id'])
        else:
            _conflict()
    return None


def claim_link(c, user, assignment_id, product_id):
    if product_id is None:
        return
    row = c.execute('''UPDATE uony_assignments SET product_id=%s,
        version=version+1,updated_at=now() WHERE user_id=%s AND id=%s
        AND google_subject=%s AND product_id IS NULL AND intake_id IS NULL
        RETURNING id''', (product_id, user['id'], assignment_id,
                         user['google_subject'])).fetchone()
    if not row:
        _conflict()
