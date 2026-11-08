"""Identificadores cerrados para citar únicamente unidades presentes en esta petición."""
from copy import deepcopy


def evidence_catalog(sources):
    result = {}
    for source in sources:
        for segment in source.get('segments', []):
            result['e' + str(len(result))] = {'sourceId': source['id'],
                'locator': segment['locator'], 'text': segment['text'], 'visual': False}
        if source.get('image'):
            result['e' + str(len(result))] = {'sourceId': source['id'],
                'locator': source.get('visualLocator', 'Imagen'), 'visual': True}
    return result


def referenced_sources(sources):
    result, index = deepcopy(sources), 0
    for source in result:
        for segment in source.get('segments', []):
            segment['evidenceRef'] = 'e' + str(index)
            index += 1
        if source.get('image'):
            source['visualEvidenceRef'] = 'e' + str(index)
            index += 1
    return result


def resolve_citation(citation, catalog):
    if 'evidenceRef' not in citation:
        return citation  # Lecturas históricas: siguen pasando la validación literal.
    entry = catalog.get(citation.get('evidenceRef'))
    if not entry:
        return {}  # Nunca aceptar otro locator/ID cuando la referencia no existe.
    return {'sourceId': entry['sourceId'], 'locator': entry['locator'],
            'excerpt': citation.get('excerpt')}
