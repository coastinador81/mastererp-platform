"""Owner-bound saved material result for Live's read-only work-status tool."""
from .uony_context import _material_text, _saved_intake_analysis


def _saved_product_analysis(row):
    """Expose a bounded saved result, never Drive content or a new action."""
    result = row['result'] if isinstance(row['result'], dict) else {}
    saved = {'status': row['status'],
             'folderName': _material_text(result.get('folderName'), 120)
                or 'Carpeta de Drive',
             'currentRevision': row['revision'] == row['product_revision']}
    if row['status'] != 'ready' or not saved['currentRevision']:
        return saved
    observations = []
    for source in result.get('sources', []) if isinstance(result.get('sources'), list) else []:
        if not isinstance(source, dict):
            continue
        name = _material_text(source.get('name'), 120)
        summary = _material_text(source.get('summary'), 360)
        if name and summary:
            observations.append({'source': name, 'summary': summary})
        if len(observations) == 8:
            break
    candidates = []
    for proposal in result.get('proposals', []) if isinstance(result.get('proposals'), list) else []:
        if not isinstance(proposal, dict):
            continue
        label = _material_text(proposal.get('label'), 100)
        value = _material_text(proposal.get('value'), 180)
        if label and value:
            candidates.append({'label': label, 'value': value})
        if len(candidates) == 10:
            break
    saved.update(observations=observations, candidateFacts=candidates,
                 sourcesTotal=result.get('total') if type(result.get('total')) is int
                     and 0 <= result['total'] <= 100000 else None)
    return saved


def latest_material_analysis(connection, identity):
    # The handoff is causal, but never itself a new Drive authorization.
    row = connection.execute('''SELECT h.turn_id,j.id AS job_id,j.intake_id,
            j.product_id,j.status,j.result,j.revision,
            p.revision AS product_revision
        FROM uony_live_handoffs h
        JOIN uony_requests r ON r.user_id=h.user_id
            AND r.request_id=h.request_id AND r.thread_id=h.thread_id
            AND r.project_id=h.google_project_id
        JOIN product_material_jobs j ON j.user_id=r.user_id
            AND j.id::text=r.material_analysis->>'jobId'
            AND j.google_subject=h.google_subject
            AND j.project_id=h.google_project_id
            AND j.intake_id::text IS NOT DISTINCT FROM
                r.material_analysis->>'intakeId'
        LEFT JOIN uony_product_intakes i ON i.user_id=j.user_id
            AND i.id=j.intake_id AND i.google_subject=j.google_subject
            AND i.folder_id=j.folder_id AND i.thread_id=h.thread_id
            AND i.status='identified'
        LEFT JOIN products p ON p.user_id=j.user_id AND p.id=j.product_id
            AND p.deleted_at IS NULL
        LEFT JOIN uony_assignment_focus f ON f.user_id=h.user_id
            AND f.thread_id=h.thread_id AND f.google_subject=h.google_subject
        LEFT JOIN uony_assignment_material_jobs link ON link.user_id=j.user_id
            AND link.material_job_id=j.id AND link.google_subject=j.google_subject
            AND link.assignment_id=f.assignment_id
            AND link.product_id IS NOT DISTINCT FROM j.product_id
            AND link.intake_id IS NOT DISTINCT FROM j.intake_id
        WHERE h.user_id=%s AND h.google_subject=%s AND h.google_project_id=%s
          AND h.thread_id=%s AND h.intent='use_drive_materials'
          AND r.status='success'
          AND ((j.intake_id IS NOT NULL AND i.id IS NOT NULL)
            OR (j.product_id IS NOT NULL AND p.id IS NOT NULL))
          AND (f.assignment_id IS NULL OR link.material_job_id IS NOT NULL)
        ORDER BY h.created_at DESC,h.turn_id DESC LIMIT 1''',
        (identity.user_id, identity.google_subject, identity.project_id,
         identity.thread_id)).fetchone()
    if not row:
        return None
    if row['product_id']:
        analysis = _saved_product_analysis(row)
    else:
        focus = connection.execute('''SELECT assignment_id FROM uony_assignment_focus
            WHERE user_id=%s AND thread_id=%s AND google_subject=%s''',
            (identity.user_id,identity.thread_id,identity.google_subject)).fetchone()
        owner = {'id': identity.user_id, 'google_subject': identity.google_subject}
        analysis = _saved_intake_analysis(connection, owner, identity.thread_id,
            row['intake_id'], focus['assignment_id'] if focus else None, row['job_id'])
    return {'turnId': str(row['turn_id']), **analysis} if analysis else None
