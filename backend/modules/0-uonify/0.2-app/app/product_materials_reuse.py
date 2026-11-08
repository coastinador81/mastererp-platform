"""Reintento explícito: reutiliza únicamente evidencias anteriores cuya revisión de Drive sigue igual."""
from copy import deepcopy
from .google_cloud_provider import CloudError


def reuse_previous(service, row, user_id, token, result):
    with service.database.connect() as c:
        previous = c.execute("""SELECT * FROM product_material_jobs WHERE user_id=%s AND product_id=%s
            AND google_subject=%s AND folder_id=%s AND status='error' AND id<>%s
            ORDER BY created_at DESC LIMIT 1""",
            (user_id, row['product_id'], row['google_subject'], row['folder_id'], row['id'])).fetchone()
    if not previous:
        return
    old_sources = {source['id']: source for source in previous['result'].get('sources', [])}
    reused = set()
    for source in result['sources']:
        old = old_sources.get(source['id'])
        if not old or old.get('status') != 'analyzed' or not old.get('modifiedTime') or not old.get('sha256'):
            continue
        if any(source.get(key) != old.get(key) for key in ('modifiedTime', 'size', 'mimeType')):
            continue
        try:
            actual = service.drive.metadata(token, source['id'])
        except CloudError:
            continue
        if actual.get('modifiedTime') != old['modifiedTime'] or actual.get('capabilities', {}).get('canDownload') is False:
            continue
        reference = {key: source[key] for key in ('id', 'name', 'path', 'url', 'mimeType', 'modifiedTime', 'size') if key in source}
        source.update(deepcopy(old))
        source.update(reference)
        source['reusedFrom'] = str(previous['id'])
        reused.add(source['id'])
    for source in result['sources']:
        old = old_sources.get(source['id'])
        if old and old.get('status') == 'duplicate' and old.get('duplicateOf') in reused and old.get('modifiedTime') and all(source.get(key) == old.get(key) for key in ('modifiedTime', 'size', 'mimeType')):
            source.update({key: deepcopy(old[key]) for key in ('status', 'duplicateOf', 'sha256', 'reason') if key in old})
            source['reusedFrom'] = str(previous['id'])
            reused.add(source['id'])
    if not reused:
        return
    for proposal in previous['result'].get('proposals', []):
        evidence = [item for item in proposal.get('evidence', []) if item['sourceId'] in reused]
        if evidence:
            result['proposals'].append({**deepcopy(proposal), 'evidence': evidence})
    result['reusedSources'] = len(reused)
    result['previousJobId'] = str(previous['id'])
    result['warnings'].append(f'{len(reused)} fuentes ya analizadas se reutilizaron tras comprobar su revisión en Drive; no se repitió su análisis de IA.')
