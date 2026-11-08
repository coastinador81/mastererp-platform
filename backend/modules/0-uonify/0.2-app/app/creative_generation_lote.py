"""Estudio §E: nivel LOTE sobre el §6 por intento (veredicto 20261022-VEREDICTO-BACKEND-ESTUDIO-GOOGLE).

Un OK cubre N piezas (1-4): sella el conjunto EXACTO por hash (lote_sha256 sobre los N quote_sha256),
el máximo reconocido es la SUMA de los máximos EXACTOS por pieza, y la aprobación es de UN SOLO USO.
No llama a ningún proveedor y NO cambia el §6: envuelve issue_complete_quote/approve_exact (por pieza)
y cada pieza conserva su reserve_once del §6 con su prefijo durable + operationId (migración 129
intacta). «Rehazlo» = un lote nuevo (otra petición → otro conjunto sellado → otro OK). Nunca por HTTP
directo: contrato privado del backend, como el ledger §6.
"""
from decimal import ROUND_CEILING, Decimal
from uuid import uuid4

from .creative_generation_ledger import (_active_user, _quote_current,
                                          approve_exact, digest, fail,
                                          issue_complete_quote)


def _lote_sha256(quote_shas):
    """Sella el conjunto EXACTO de piezas por sus quote_sha256, en orden canónico."""
    return digest({'pieces': sorted(quote_shas)})


def _cents_up(value):
    # El AGREGADO del lote se redondea SIEMPRE hacia arriba (ROUND_CEILING): el máximo reconocido
    # por el dueño nunca puede quedar por debajo de la suma real de los máximos exactos por pieza
    # (cada pieza factura ≤ su máximo en el §6). Coherente con §F («siempre hacia arriba, nunca menos
    # que el real»). Hoy el máximo por pieza ya es de 2 decimales (numeric(12,2) + _price), así que la
    # suma es exacta y el ceiling es identidad; el redondeo hacia arriba lo garantiza aunque la
    # precisión de entrada cambiara. Un HALF_EVEN sí podría bajar (0.264 -> 0.26 < 0.264).
    return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_CEILING)


def issue_lote_quote(c, user, thread_id, lote_issue_request_id, pieces):
    """pieces = [(plan_id, piece_issue_request_id, request, cost), ...], 1-4. Cotiza cada pieza por
    el §6, sella el conjunto y suma los máximos exactos. Idempotente por lote_issue_request_id."""
    user = _active_user(c, user)
    if not isinstance(pieces, (list, tuple)) or not 1 <= len(pieces) <= 4:
        fail('creative_lote_size', 'Un lote tiene entre 1 y 4 piezas.', 422)
    quotes = [issue_complete_quote(c, user, plan_id, piece_req, request, cost)
              for (plan_id, piece_req, request, cost) in pieces]
    if any(q['threadId'] != thread_id for q in quotes):
        fail('creative_lote_thread_mismatch', 'Todas las piezas deben ser del mismo hilo.', 409)
    if len({q['quoteId'] for q in quotes}) != len(quotes):
        fail('creative_lote_duplicate_piece', 'Una pieza del lote está repetida.', 409)
    lote_sha = _lote_sha256([q['quoteSha256'] for q in quotes])
    max_total = _cents_up(sum((Decimal(q['maxTotalUsd']) for q in quotes), Decimal('0')))
    prior = c.execute('''SELECT * FROM creative_generation_lotes
        WHERE user_id=%s AND issue_request_id=%s''',
        (user['id'], lote_issue_request_id)).fetchone()
    if prior:
        if prior['lote_sha256'] != lote_sha or prior['max_total_usd'] != max_total:
            fail('creative_lote_request_conflict', 'Esta petición ya tiene otro lote.', 409)
        return _lote_view(c, user, prior)
    lote_id = uuid4()
    row = c.execute('''INSERT INTO creative_generation_lotes
        (id,user_id,thread_id,issue_request_id,lote_sha256,max_total_usd,piece_count)
        VALUES(%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (user_id,issue_request_id) DO NOTHING RETURNING *''',
        (lote_id, user['id'], thread_id, lote_issue_request_id, lote_sha, max_total,
         len(quotes))).fetchone()
    if not row:
        prior = c.execute('''SELECT * FROM creative_generation_lotes
            WHERE user_id=%s AND issue_request_id=%s''',
            (user['id'], lote_issue_request_id)).fetchone()
        if not prior or prior['lote_sha256'] != lote_sha:
            fail('creative_lote_request_conflict', 'Esta petición ya tiene otro lote.', 409)
        return _lote_view(c, user, prior)
    for ordinal, q in enumerate(quotes, 1):
        c.execute('''INSERT INTO creative_generation_lote_pieces
            (user_id,lote_id,ordinal,quote_id,approval_request_id)
            VALUES(%s,%s,%s,%s,%s)''',
            (user['id'], lote_id, ordinal, q['quoteId'], uuid4()))
    return _lote_view(c, user, row)


def approve_lote_exact(c, user, thread_id, lote_id, lote_sha256, max_total_usd, acknowledged):
    """UN OK por lote: valida el conjunto sellado + la suma exacta, aprueba cada pieza del §6
    (approve_exact) y registra la aprobación del lote (de un solo uso). Idempotente."""
    user = _active_user(c, user)
    if acknowledged is not True:
        fail('creative_approval_required', 'Confirma el máximo y el conjunto exacto.', 422)
    lote = c.execute('''SELECT * FROM creative_generation_lotes
        WHERE user_id=%s AND thread_id=%s AND id=%s FOR SHARE''',
        (user['id'], thread_id, lote_id)).fetchone()
    if not lote:
        fail('creative_lote_not_found', 'No se encuentra este lote.', 404)
    if lote['lote_sha256'] != lote_sha256 or lote['max_total_usd'] != _cents_up(max_total_usd):
        fail('creative_lote_mismatch', 'El lote ha cambiado. Revísalo otra vez.', 409)
    prior = c.execute('''SELECT * FROM creative_generation_lote_approvals
        WHERE user_id=%s AND lote_id=%s''', (user['id'], lote_id)).fetchone()
    if prior:
        return _lote_approval_view(c, user, prior)
    pieces = c.execute('''SELECT * FROM creative_generation_lote_pieces
        WHERE user_id=%s AND lote_id=%s ORDER BY ordinal''',
        (user['id'], lote_id)).fetchall()
    for p in pieces:
        quote = c.execute('''SELECT * FROM creative_generation_quotes
            WHERE user_id=%s AND id=%s''', (user['id'], p['quote_id'])).fetchone()
        if not _quote_current(c, user, quote):
            fail('creative_lote_stale', 'Una pieza del lote ha cambiado; revisa el lote.', 409)
        approval = approve_exact(
            c, user, thread_id, p['quote_id'], p['approval_request_id'], quote['quote_sha256'],
            quote['plan_revision'], quote['plan_sha256'], quote['request_sha256'],
            quote['max_total_usd'], True)
        c.execute('''UPDATE creative_generation_lote_pieces SET approval_id=%s
            WHERE user_id=%s AND lote_id=%s AND ordinal=%s''',
            (approval['approvalId'], user['id'], lote_id, p['ordinal']))
    row = c.execute('''INSERT INTO creative_generation_lote_approvals
        (id,user_id,lote_id,actor_id,lote_sha256,max_total_usd)
        VALUES(%s,%s,%s,%s,%s,%s)
        ON CONFLICT (user_id,lote_id) DO NOTHING RETURNING *''',
        (uuid4(), user['id'], lote_id, user['id'], lote['lote_sha256'],
         lote['max_total_usd'])).fetchone()
    if not row:
        row = c.execute('''SELECT * FROM creative_generation_lote_approvals
            WHERE user_id=%s AND lote_id=%s''', (user['id'], lote_id)).fetchone()
    return _lote_approval_view(c, user, row)


def _pieces_view(c, user, lote_id):
    rows = c.execute('''SELECT * FROM creative_generation_lote_pieces
        WHERE user_id=%s AND lote_id=%s ORDER BY ordinal''',
        (user['id'], lote_id)).fetchall()
    return [{'ordinal': p['ordinal'], 'quoteId': str(p['quote_id']),
             'requestId': str(p['approval_request_id']),
             'approvalId': str(p['approval_id']) if p['approval_id'] else None} for p in rows]


def _lote_view(c, user, row):
    return {'loteId': str(row['id']), 'threadId': row['thread_id'],
            'loteSha256': row['lote_sha256'], 'maxTotalUsd': str(row['max_total_usd']),
            'pieceCount': row['piece_count'], 'pieces': _pieces_view(c, user, row['id'])}


def _lote_approval_view(c, user, row):
    return {'loteApprovalId': str(row['id']), 'loteId': str(row['lote_id']),
            'loteSha256': row['lote_sha256'], 'maxTotalUsd': str(row['max_total_usd']),
            'pieces': _pieces_view(c, user, row['lote_id'])}
