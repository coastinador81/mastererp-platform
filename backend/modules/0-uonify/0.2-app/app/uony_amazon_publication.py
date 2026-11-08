"""Tenant-scoped, read-only Amazon ledger summary for a Uony return brief.

These records describe Uonify's local workflow. Even a fresh matching listing
observation does not prove that our submission caused it or verify a retail URL.
"""
from .amazon_publish_followup import load_status


PHASE_TEXT = {
    'reserved': 'Hay un intento reservado; todavía no conocemos el resultado del envío.',
    'rejected_initial': 'Amazon rechazó inicialmente el intento guardado. Revisa sus observaciones antes de avanzar.',
    'outcome_unknown': 'El resultado del intento de envío es incierto. Hay que conciliarlo antes de intentar otra vez.',
    'awaiting_amazon': 'Amazon aceptó inicialmente el envío; aún falta comprobar el estado de la ficha.',
    'checking': 'Amazon aceptó inicialmente el envío y la comprobación de visibilidad está en curso.',
    'check_failed': 'Amazon aceptó inicialmente el envío, pero la última consulta falló. La visibilidad actual no está comprobada.',
    'visibility_check_stale': 'Antes se observó una ficha visible, pero esa comprobación ya no acredita su estado actual.',
    'not_found': 'Amazon aceptó inicialmente el envío; la última consulta no encontró la ficha.',
    'listing_present': 'Amazon aceptó inicialmente el envío y se encontró una ficha, pero su visibilidad no está comprobada.',
    'issues': 'Amazon aceptó inicialmente el envío, pero la última consulta encontró incidencias en la ficha.',
    'unmatched': 'La última consulta encontró una ficha que no coincide con la revisión aprobada.',
    'visible_current': ('Una comprobación reciente observó una ficha visible para este vendedor y SKU '
                        'con atributos coincidentes. No demuestra que nuestro envío la causara ni verifica un enlace de compra.'),
}


def read(c, user, binding):
    """Summarize saved evidence only; no provider, queue, mutation or retry."""
    owner = (user['id'], binding['product_id'])
    snapshot = c.execute('''SELECT id,product_revision,prepared_at FROM amazon_publish_snapshots
        WHERE user_id=%s AND product_id=%s
        ORDER BY prepared_at DESC,id DESC LIMIT 1''', owner).fetchone()
    approval = c.execute('''SELECT id,snapshot_id,product_revision,approved_at
        FROM amazon_publish_approvals WHERE user_id=%s AND product_id=%s
        ORDER BY approved_at DESC,id DESC LIMIT 1''', owner).fetchone()
    attempt = c.execute('''SELECT t.id,t.status,t.reserved_at,a.id AS approval_id,
            a.snapshot_id,a.product_revision
        FROM amazon_publish_attempts t JOIN amazon_publish_approvals a
          ON a.user_id=t.user_id AND a.id=t.approval_id
        WHERE t.user_id=%s AND a.product_id=%s
        ORDER BY t.reserved_at DESC,t.id DESC LIMIT 1''', owner).fetchone()
    selected = attempt or approval or snapshot
    revision = selected['product_revision'] if selected else None
    current_revision = revision == binding['revision'] if selected else False
    newer_draft = bool(snapshot and selected and snapshot['id'] != selected.get('snapshot_id', selected['id'])
                       and snapshot['prepared_at'] > (selected.get('reserved_at')
                           or selected.get('approved_at') or selected.get('prepared_at')))
    detail = {'snapshotId': str(selected.get('snapshot_id', selected['id'])) if selected else None,
              'approvalId': str(attempt['approval_id']) if attempt else
                  str(approval['id']) if approval else None,
              'attemptId': str(attempt['id']) if attempt else None,
              'productRevision': revision, 'matchesProductRevision': current_revision,
              'newerLocalDraft': newer_draft, 'currentVisibilityVerified': False,
              'retailLinkVerified': False, 'causedByThisSubmission': None}
    if attempt:
        observation = load_status(c, user, attempt['id'])
        phase = observation['phase']
        detail['currentVisibilityVerified'] = observation['currentVisibilityVerified']
        detail['lastCheckedAt'] = (observation['latestCheck'] or {}).get('checkedAt')
        detail['submissionStatus'] = observation['submissionStatus']
        summary = PHASE_TEXT.get(phase, 'El estado del intento necesita una revisión antes de continuar.')
    elif approval:
        phase = 'approved_not_sent'
        summary = 'Aprobaste una revisión exacta de la ficha, pero no consta un intento de envío desde Uonify.'
    elif snapshot:
        phase = 'local_draft'
        summary = 'Hay una vista previa local de Amazon guardada. Amazon aún no ha recibido este borrador desde Uonify.'
    else:
        phase = 'not_started'
        summary = 'Aún no hay una vista previa local de Amazon guardada para esta ficha.'
    if selected and not current_revision:
        summary += ' Esta evidencia corresponde a una revisión anterior de la ficha.'
    if newer_draft:
        summary += ' También hay un borrador local más reciente para revisar.'
    detail['phase'] = phase
    return detail, summary
