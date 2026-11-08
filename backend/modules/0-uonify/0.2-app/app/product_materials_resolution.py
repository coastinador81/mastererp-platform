"""Estado resoluble del análisis: lectura, errores técnicos, historial y decisiones del cliente."""
from collections import Counter
from hashlib import sha256

TERMINAL = {'done', 'partial'}
DISCARD_WARNING = 'propuestas requieren comprobar su evidencia'


def fragment_problem(fragment, facts=None):
    """Un descarte con causa conservada no es un error de lectura eternamente pendiente."""
    if fragment['state'] in ('split', 'superseded'):
        return None
    if fragment['state'] not in TERMINAL:
        return 'La interpretación de esta parte todavía no ha terminado.'
    result = fragment.get('result') or {}
    discarded = result.get('discardedProposalCount', 0)
    if discarded and ('candidates' not in result or discarded > len(result.get('rejections', []))):
        return 'Esta lectura antigua descartó propuestas sin conservar su detalle. Hay que comprobar esta parte.'
    if result.get('coverageLimited') or result.get('outputLimit'):
        return 'La respuesta anterior no cubrió toda esta parte del archivo.'
    if not result.get('observations', {}).get(fragment['source_id']):
        # Los registros históricos completos sin aviso no se convierten en fallos nuevos.
        if fragment['state'] == 'partial':
            return 'Falta el resultado individual de esta parte del archivo.'
    supported = {pid for fact in (facts or {}).get('proposals', [])
                 if fact.get('supportStatus') in ('supported', 'needs_review')
                 and any(e.get('fragmentId') == fragment['id'] for e in fact.get('evidence', []))
                 for pid in fact.get('sourceProposalIds', [])}
    if any(r.get('code') == 'citation_not_found' and r.get('id') not in supported
           for r in result.get('rejections', [])):
        return 'Una propuesta no identificó correctamente su fuente. Hay que comprobar su cita.'
    warnings = [w for w in result.get('warnings', []) if DISCARD_WARNING not in w]
    if fragment['state'] == 'partial' and warnings:
        return warnings[0]
    return None


def source_complete(source):
    return bool(source.get('readComplete') and not source.get('changed') and
                source.get('status') not in ('skipped', 'error') and not source.get('truncated') and
                source.get('readingCoverage', {}).get('complete', True))


def _issue(kind, key, title, detail, action=None, **extra):
    return {'id': 'issue_' + sha256((kind + ':' + key).encode()).hexdigest()[:24],
            'kind': kind, 'status': 'pending', 'title': title, 'detail': detail,
            **({'action': action} if action else {}), **extra}


def repaired_roots(fragments, facts):
    """Contar cada incidencia original una vez y solo si toda su descendencia cerró."""
    by_id = {f['id']: f for f in fragments}
    children = {}
    for fragment in fragments:
        parent = (fragment.get('payload') or {}).get('parentId')
        if parent:
            children.setdefault(parent, []).append(fragment['id'])
    def closed(identifier, visited):
        if identifier in visited or identifier not in by_id:
            return False
        fragment = by_id[identifier]
        payload = fragment.get('payload') or {}
        visited = visited | {identifier}
        if fragment['state'] == 'superseded':
            return closed(fragment.get('repairReplacedBy') or payload.get('repairReplacedBy'), visited)
        if fragment['state'] == 'split':
            leaves = children.get(identifier, [])
            return bool(leaves) and all(closed(child, visited) for child in leaves)
        return fragment['state'] in TERMINAL and fragment_problem(fragment, facts) is None
    return sum(f['state'] == 'superseded' and not (f.get('payload') or {}).get('repairOf')
               and closed(f['id'], set()) for f in fragments)


def project_resolution(sources, fragments, facts=None):
    from .product_materials_review import groups_of
    facts = facts or {}
    issues, history = [], 0
    by_id = {s['id']: s for s in sources}
    for source in sources:
        if source_complete(source):
            continue
        coverage = source.get('readingCoverage', {})
        pending_entries = [e for e in coverage.get('archiveEntries', [])
                           if e.get('status') not in ('read', 'directory')]
        if pending_entries:
            for entry in pending_entries:
                issues.append(_issue('reading', source['id'] + ':' + entry['path'], entry['path'],
                    entry.get('reason', 'No se ha completado la lectura de este archivo interno.'),
                    'upgrade_readers', sourceId=source['id']))
        else:
            issues.append(_issue('reading', source['id'], source['name'],
                source.get('reason') or 'La lectura no cubre todavía todo el archivo.',
                'replace_source' if source.get('changed') or source.get('status') == 'skipped' else 'retry',
                sourceId=source['id']))
    source_histories = Counter()
    for fragment in fragments:
        result = fragment.get('result') or {}
        discarded = result.get('discardedProposalCount', 0)
        if discarded:
            history += discarded if 'candidates' not in result else max(0, discarded - len(result.get('rejections', [])))
        source_histories[fragment['source_id']] += discarded
        problem = fragment_problem(fragment, facts)
        if not problem:
            continue
        payload = fragment.get('payload') or {}
        repair_round = payload.get('repairRound') or 0
        action = ('repair_evidence' if fragment['state'] in TERMINAL and repair_round < 2
                  else 'replace_source' if repair_round >= 2 else 'retry')
        issues.append(_issue('evidence', fragment['id'], by_id.get(fragment['source_id'], {}).get('name', 'Archivo'),
            problem, action, sourceId=fragment['source_id'], fragmentId=fragment['id']))
    groups = groups_of(facts.get('proposals', []))
    for group in groups:
        fact = group[0]
        if fact.get('resolution', {}).get('status') == 'awaiting_source':
            observation = fact.get('observationIssue', {})
            issues.append({**_issue('client', fact['id'], fact['label'],
                'El recurso contiene un dato incorrecto. Aporta una versión corregida y vuelve a analizar sus fuentes; la ficha conserva el dato confirmado.',
                'replace_source', factId=fact['id'], sourceId=observation.get('sourceId')),
                'status': 'awaiting_source'})
            continue
        issues.append({**_issue('client', fact['id'], fact['label'],
            'Revisa el valor y su fuente en las preguntas de Uony.', 'review', factId=fact['id']),
            'status': 'awaiting_client'})
    technical = [i for i in issues if i['kind'] != 'client']
    discarded_facts = sum(f.get('supportStatus') == 'unsupported' or f.get('status') == 'rejected'
                          for f in facts.get('proposals', []))
    resolved_facts = sum(f.get('status') in ('confirmed', 'rejected') or bool(f.get('coveredByFactIds'))
                         for f in facts.get('proposals', []))
    by_source = Counter(i.get('sourceId') for i in technical)
    return {'version': 1, 'processedSources': sum(bool(s.get('readComplete')) or s.get('status') in ('error', 'skipped') for s in sources),
            'completeSources': sum(source_complete(s) for s in sources),
            'technicalPendingCount': len(technical), 'clientPendingCount': sum(i['kind'] == 'client' and i['status'] == 'awaiting_client' for i in issues),
            'sourcePendingCount': sum(i['status'] == 'awaiting_source' for i in issues),
            'discardedProposalCount': discarded_facts, 'historicalRejectionCount': history,
            'resolvedCount': resolved_facts + repaired_roots(fragments, facts), 'issues': issues,
            'sourceSummaries': {s['id']: {'technicalPendingCount': by_source[s['id']],
                'historicalDiscardCount': source_histories[s['id']]} for s in sources}}


def minimal_fragments(c, job_id):
    """No transportar imágenes/base64 a cada proyección del estado público."""
    return c.execute("""SELECT id,source_id,state,result,
        jsonb_build_object('repairRound',payload->'repairRound','repairOf',payload->'repairOf',
            'parentId',payload->'parentId') AS payload,
        payload->>'repairReplacedBy' AS "repairReplacedBy"
        FROM product_material_fragments WHERE job_id=%s""", (job_id,)).fetchall()


def apply_resolution(result, fragments):
    resolution = project_resolution(result.get('sources', []), fragments, result.get('facts'))
    result['resolution'] = resolution
    result['repairAvailable'] = any(i.get('action') == 'repair_evidence' for i in resolution['issues'])
    result['coverageLimited'] = bool(resolution['technicalPendingCount'])
    result['unreviewed'] = sum(s['technicalPendingCount'] > 0 for s in resolution['sourceSummaries'].values())
    result['warnings'] = ([f"Hay {resolution['technicalPendingCount']} comprobaciones de lectura por resolver."]
                          if resolution['technicalPendingCount'] else [])
    for source in result.get('sources', []):
        source['resolutionSummary'] = resolution['sourceSummaries'][source['id']]
    return result
