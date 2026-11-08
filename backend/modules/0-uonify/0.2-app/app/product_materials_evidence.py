"""Citas verificadas contra fragmentos originales y apoyo conservador atributo/valor."""
from collections import defaultdict
from hashlib import sha256
import json
from copy import deepcopy
import re
from .product_materials_fields import field_aliases, normalized_label, canonical_attribute
from .product_materials_values import value_supported, stripped_value

REASONS = {
    'source_missing': 'La fuente citada no pertenece a este análisis.',
    'source_version_changed': 'La versión citada no coincide con la fuente conservada.',
    'citation_missing': 'La cita no aparece literalmente en el localizador del original.',
    'input_context': 'La cita describe datos del contexto de entrada, no contenido observado en esta fuente.',
    'value_not_supported': 'La cita existe, pero no respalda el valor propuesto.',
    'attribute_not_supported': 'No consta que este valor corresponda al atributo propuesto.',
    'reference_source': 'Documento de referencia o iconografía; no describe el producto del cliente.',
    'missing_value': 'La fuente indica un dato pendiente, no un valor confirmado.',
    'ocr_pending': 'Texto reconocido por OCR; necesita revisión contra la imagen original.',
    'chart_cache_pending': 'Valores guardados de un gráfico, sin recálculo ni comprobación de vigencia.',
    'barcode_observed': 'Código decodificado en el recurso; no acredita titularidad ni conformidad del producto.',
    'formula_uncertain': 'El valor procede de una fórmula no recalculada; falta comprobar su vigencia.',
    'visual_pending': 'Observación de imagen pendiente de comprobación; no es evidencia documental.',
    'certification_unverified': 'Una declaración o un sello no acredita la revisión de ensayos o conformidad.',
    'invalid_gtin': 'El identificador no cumple el dígito de control de EAN-13.',
    'scope_unverified': 'El alcance o la variante no está respaldado por el original.',
}
REFERENCE_NAMES = re.compile(r'\b(directrices|comision europea|iconografia|procedencia mobius|recycling symbol original|ce oficial|competidor|competitor|referencia externa)\b')
PRODUCTION = re.compile(r'\b(render|renderizado|renderizado3d|escena|scene|camera|camara|lights|iluminacion|resolution|resolucion|samples|muestras de render|cycles|gpu|blender|objeto fuente|source object|archivo editable|archivo render|formato de imagen|formato render|approval|aprobacion visual|inventario id)\b')
SAFETY = re.compile(r'\b(seguridad|safety|advertencia|peligro|certificacion|conformidad|fsc|ukca|cpsia|astm|formaldehido|reciclaje|simbolos|pictograma|marcado|responsable ue)\b')
NOMINAL = re.compile(r'\b(nominales?|diseno 3d|modelo 3d|provisional|propuesto|propuesta|no muestra fisica|no verificado fisicamente)\b')
PENDING = re.compile(r'^(?:pendiente|por confirmar|desconocido|null|n/?a|sin dato|no disponible|no confirmad[oa])\b')
INPUT_CONTEXT = re.compile(r'\bproducto objetivo\b|\b(?:datos|nombre|valor)\s+(?:declarad[oa]s?|proporcionad[oa]s?|suministrad[oa]s?|aportad[oa]s?)\s+por\s+(?:el\s+)?cliente\b|\b(?:prompt|metadatos de entrada|contexto de entrada)\b')


def stable_id(prefix, *values):
    raw = json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return prefix + sha256(raw.encode()).hexdigest()[:24]



def evidence_metadata(value):
    # Metadatos del lector conservado, nunca coordenadas propuestas por el modelo.
    keys = ('region', 'method', 'confidence', 'observational', 'format', 'structureValid',
            'formulaEvidence', 'formulaUncertain', 'barcode')
    return {key: deepcopy(value[key]) for key in keys if key in value}


class EvidenceIndex:
    def __init__(self, sources, fragments):
        self.sources = {source['id']: source for source in sources}
        self.by_source = defaultdict(list)
        self.by_locator = defaultdict(list)
        self.parents = defaultdict(list)
        self.images = defaultdict(list)
        for fragment in fragments:
            if fragment.get('state') == 'superseded':
                continue
            payload = fragment.get('payload', fragment)
            source_id = fragment.get('source_id', fragment.get('sourceId', payload.get('id')))
            source = self.sources.get(source_id, {})
            version = fragment.get('version') or source.get('version') or source.get('sha256') or source.get('modifiedTime', '')
            fragment_id = fragment.get('id') if 'payload' in fragment else payload.get('fragmentId')
            fragment_id = fragment_id or stable_id('fragment_', source_id, version, payload.get('segments', []))
            base = {'sourceId': source_id, 'sourceVersion': version, 'fragmentId': str(fragment_id)}
            if payload.get('image'):
                self.images[source_id].append({**base, 'locator': payload.get('visualLocator', 'Imagen'),
                                              **evidence_metadata(payload)})
            for segment in payload.get('segments', []):
                entry = {**base, 'locator': segment['locator'], 'text': segment['text'], **evidence_metadata(segment)}
                formula_evidence = [item for item in source.get('readingCoverage', {}).get('formulaEvidence', []) if item.get('rowLocator') == segment['locator']]
                if formula_evidence:
                    entry.update(formulaEvidence=deepcopy(formula_evidence), formulaUncertain=True)
                if segment.get('method') in ('ocr', 'barcode') or segment.get('observational'):
                    entry['visual'] = True
                self.by_source[source_id].append(entry)
                self.by_locator[(source_id, segment['locator'])].append(entry)
                if segment['locator'].startswith('$'):
                    parent = segment['locator'].rsplit('.', 1)[0]
                    self.parents[(source_id, parent)].append(entry)
        # Recuperación y contexto deterministas, no dependientes del orden de lectura/worker.
        for mapping in (self.by_source, self.by_locator, self.parents, self.images):
            for entries in mapping.values():
                entries.sort(key=lambda item: (item['locator'], item['fragmentId']))

    def context(self, entry):
        locator, text = entry['locator'], entry['text']
        if locator.startswith('$'):
            parent = locator.rsplit('.', 1)[0]
            siblings = [entry] if parent == '$' else self.parents[(entry['sourceId'], parent)]
            siblings = siblings + [item for item in self.by_locator.get((entry['sourceId'], '$.sku'), [])
                                   if item not in siblings]
            # Sólo el mismo registro JSON: nunca otras filas/atributos cercanos.
            return '__locator__:' + locator + '\n' + '\n'.join(s['locator'] + ': ' + s['text'] for s in siblings)
        return locator + ': ' + text

    def context_citations(self, entry):
        locator = entry['locator']
        if not locator.startswith('$'):
            return []
        siblings = self.parents[(entry['sourceId'], locator.rsplit('.', 1)[0])]
        result = []
        for sibling in siblings:
            if sibling['locator'] != locator and sibling['locator'].rsplit('.', 1)[-1] in {'label', 'unit', 'status', 'note'}:
                record = {key: sibling[key] for key in ('sourceId', 'sourceVersion', 'fragmentId', 'locator')}
                record['excerpt'] = sibling['text']
                record['citationId'] = stable_id('citation_', record)
                result.append(record)
        return list({item['citationId']: item for item in result}.values())

    def verify(self, raw):
        source_id, locator, excerpt = (raw.get(key) for key in ('sourceId', 'locator', 'excerpt'))
        source = self.sources.get(source_id)
        if not source:
            return None, 'source_missing'
        if raw.get('sourceVersion') and source.get('version') and raw['sourceVersion'] != source['version']:
            return None, 'source_version_changed'
        if not isinstance(locator, str) or not isinstance(excerpt, str) or not excerpt.strip():
            return None, 'citation_missing'
        image = [entry for entry in self.images.get(source_id, []) if entry['locator'] == locator]
        if len(image) == 1:
            if INPUT_CONTEXT.search(normalized_label(excerpt)):
                return None, 'input_context'
            if source.get('version') and image[0]['sourceVersion'] != source['version']:
                return None, 'source_version_changed'
            return {**image[0], 'excerpt': excerpt, 'visual': True}, None
        candidates = self.by_locator.get((source_id, locator), [])
        found = next((entry for entry in candidates if excerpt in entry['text']), None)
        if not found:
            return None, 'citation_missing'
        if source.get('version') and found['sourceVersion'] != source['version']:
            return None, 'source_version_changed'
        # Recuperar los bytes citados desde servidor; nunca guardar texto regenerado por el modelo.
        position = found['text'].index(excerpt)
        return {**found, 'excerpt': found['text'][position:position + len(excerpt)]}, None

    def recover(self, source_id, field, label, value, locator=None):
        """Recupera una cita en la misma fuente sólo si el atributo y su valor están explícitos."""
        source = self.sources.get(source_id, {})
        if REFERENCE_NAMES.search(normalized_label(source.get('name', ''))):
            return None
        for entry in self.by_source.get(source_id, []):
            # No recuperar el valor de otra variante/objeto/cara por compartir archivo.
            scoped_path = r'^(.*?(?:variants?|variantes?|objects?|objetos?|shots)\[\d+\])'
            expected_scope = re.match(scoped_path, locator or '')
            actual_scope = re.match(scoped_path, entry['locator'])
            if (expected_scope[1] if expected_scope else '') != (actual_scope[1] if actual_scope else ''):
                continue
            if 'Blender · Objeto' in (locator or ''):
                if locator.split(' · Geometría')[0] != entry['locator'].split(' · Geometría')[0]:
                    continue
            context = self.context(entry)
            if support_reason(field, label, value, entry['text'], context) is not None:
                continue
            # Todo el texto sigue conservado en el fragmento; aquí se entrega una cita de revisión.
            text = entry['text']
            needle = stripped_value(value).casefold()
            position = text.casefold().find(needle)
            if len(text) > 800 and position < 0:
                continue  # No recortar fuera del dato que pretendemos respaldar.
            start = max(0, position - 180)
            excerpt = text[start:start + 800] if len(text) > 800 else text
            if support_reason(field, label, value, excerpt, context) is None:
                return {**entry, 'excerpt': excerpt, 'recovered': True}
        return None


def semantic_context(field, label, value, excerpt, context):
    """Comprueba la relación con el atributo, no la mera presencia de palabras en el documento."""
    norm = normalized_label(context)
    aliases = set(field_aliases(field, label))
    aliases.add(normalized_label(label))
    # JSON de ficha técnica expresa label y value como hojas hermanas del mismo registro.
    declared_labels = re.findall(r'\.label:\s*"([^"\n]+)"', context)
    if declared_labels:
        return any(canonical_attribute('', item) == field for item in declared_labels)
    if field == 'name':
        aliases.update({'model', 'product', 'producto', 'nombre', 'modelo'})
    elif field == 'custom:edad_minima':
        aliases.update({'age', 'age years', 'edad', 'age minimum'})
    elif field == 'custom:numero_piezas':
        aliases.update({'blocks', 'pieces', 'bloques', 'piezas', 'count'})
    elif field == 'custom:material':
        aliases.update({'material main', 'material'})
    elif field == 'custom:fabricante':
        aliases.add('manufacturer')
    elif field == 'custom:persona_responsable':
        aliases.update({'eu responsible', 'responsible person', 'responsible name'})
    elif field == 'custom:pais_fabricacion':
        aliases.update({'country of manufacture', 'country', 'origin'})
    elif field == 'custom:lote':
        aliases.add('batch')
    elif field == 'custom:modelo':
        aliases.add('model')
    elif field == 'custom:ean_gtin_13':
        aliases.update({'ean13', 'gtin', 'ean', 'barcode'})
    aliases.update({
        'custom:dimensiones_pieza': {'bloque'}, 'custom:dimensiones_torre': {'torre montada'},
        'custom:dimensiones_caja': {'caja cerrada'}, 'custom:motor_render': {'engine'},
        'custom:dispositivo_render': {'device'}, 'custom:formato_render': {'format'},
        'custom:resolucion_render': {'resolution'}, 'custom:objeto_fuente': {'source object'},
        'custom:escena_3d': {'scene'}, 'custom:frase_superior': {'phrases superior'},
        'custom:frase_inferior': {'phrases inferior'}, 'custom:archivo_editable': {'editable'},
        'custom:identificador_de_inventario': {'inventory id'}, 'custom:estado_de_aprobacion': {'approval status'},
        'custom:etapa_de_diseno': {'stage'}, 'custom:muestras_de_render': {'samples'},
        'custom:revision_de_arte': {'artwork revision'}, 'custom:contacto_correo': {'correo'},
    }.get(field, set()))
    def has_alias(text):
        normalized = normalized_label(text)
        return any(alias and re.search(r'(?<!\w)' + re.escape(alias) + r'(?!\w)', normalized) for alias in aliases)
    locator_match = re.match(r'__locator__:(.+)', context)
    if locator_match:
        # Descripciones de tomas conservan su selector propio; no confundir nombres
        # de luces con objetos, escenas o inscripciones del producto.
        if re.fullmatch(r'\$\.outputs\[\d+\]\.scene', locator_match[1]) and normalized_label(label).startswith('escena render '):
            return True
        if re.fullmatch(r'\$\.outputs\[\d+\]\.file', locator_match[1]) and normalized_label(label).startswith('archivo render '):
            return True
        return has_alias(locator_match[1])
    # Las celdas de una fila de ficha conservan la relación rótulo/valor.
    cells = re.search(r'\bA(?:\([^)]*\))?:\s*([^|]+)\|\s*B(?:\([^)]*\))?:\s*([^|]+)', context)
    if cells:
        return (canonical_attribute('', cells[1].strip()) == field and
                value_supported(field, value, cells[2], context))
    for line in context.splitlines():
        labels = list(re.finditer(r'([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ _·/()-]{1,55}):\s*', line))
        semantic_labels = [m for m in labels if len(m[1].strip()) > 1 and not m[1].strip().startswith(('Página ', 'Línea '))]
        if semantic_labels:
            for i, match in enumerate(semantic_labels):
                end = semantic_labels[i + 1].start() if i + 1 < len(semantic_labels) else len(line)
                if has_alias(match[1]) and value_supported(field, value, line[match.end():end], context):
                    return True
            continue
        # PDF/Word: rótulo y valor en la misma línea, o rótulo aislado y la línea siguiente.
        if has_alias(line) and value_supported(field, value, line, context):
            return True
    lines = context.splitlines()
    for i, line in enumerate(lines[:-1]):
        if len(line.strip()) <= 100 and has_alias(line) and value_supported(field, value, lines[i + 1], context):
            return True
    return False


def support_reason(field, label, value, excerpt, context):
    # Los operandos de una fórmula no son el resultado ni un atributo del producto.
    excerpt = re.sub(r'\[fórmula:[^\]]*(?:\]|$)', '', excerpt, flags=re.I)
    context = re.sub(r'\[fórmula:[^\]]*(?:\]|$)', '', context, flags=re.I)
    if PENDING.search(normalized_label(stripped_value(value))):
        return 'missing_value'
    if not value_supported(field, value, excerpt, context):
        return 'value_not_supported'
    if not semantic_context(field, label, value, excerpt, context):
        return 'attribute_not_supported'
    # Los requisitos/documentos faltantes no equivalen a un dato existente.
    locator = re.match(r'__locator__:([^\n]+)', context)
    if locator and re.search(r'\$\.(?:missing|pending|requirements)\[', locator[1]):
        return 'missing_value'
    return None


def formula_operand_only(entry, field, value):
    """Una cita literal de la expresión no prueba un resultado ausente o diferente.

    Las continuaciones pueden empezar dentro de la fórmula y perder su marcador
    inicial. La expresión completa conservada por el lector permite reconocerlas.
    """
    formulas = entry.get('formulaEvidence', [])
    if not formulas:
        return False
    if any(item.get('cacheStatus') == 'cached_unverified' and
           value_supported(field, value, str(item.get('cachedValue', ''))) for item in formulas):
        return False
    excerpt = entry['excerpt'].split('; caché:', 1)[0].strip()
    return bool(excerpt and any(excerpt in str(item.get('formula', '')) for item in formulas))


def classify(field, label, value, entry, source, context, product=None):
    """Separa las afirmaciones por lo que acredita la fuente, no por una etiqueta de la IA."""
    name = normalized_label(source.get('name', ''))
    locator = normalized_label(entry['locator'])
    combined = normalized_label(label + ' ' + value + ' ' + context)
    scope = 'product'
    target_sku = (product or {}).get('sku')
    source_skus = re.findall(r'(?:\.sku:\s*"|\bSKU:\s*)([^"\n|]+)', context, re.I)
    if target_sku and source_skus and any(item.strip() != target_sku for item in source_skus):
        return 'reference', 'declared', 'product:' + source_skus[0].strip()
    variant = re.search(r'\b(variants?|variantes?)\[(\d+)\]', entry['locator'])
    if variant:
        scope = f"variant:{entry['sourceId']}:{variant[0]}"
    reference_context = normalized_label(entry.get('excerpt', '') + ' ' + context)
    reference_path = normalized_label(source.get('path', ''))
    if (REFERENCE_NAMES.search(name) or source.get('documentRole') in ('reference', 'competitor', 'iconography')
            or re.search(r'\b(?:referencias externas|productos competidores)\b', reference_path)
            or re.search(r'\b(?:producto de referencia|producto competidor|ejemplo de otro producto)\b', reference_context)):
        return 'reference', 'declared', scope
    if source.get('readerMetadata', {}).get('format') == 'blend' or re.search(r'(?:^| · )Blender ·', entry['locator']):
        # La escena describe objetos de diseño, aunque la IA proponga un atributo comercial.
        object_locator = entry['locator'].split(' · Geometría', 1)[0]
        return 'production', 'nominal', f"asset:{entry['sourceId']}:{object_locator}"
    if entry.get('visual'):
        # Inscripciones y detalles de una pieza describen ese recurso, no todas las piezas del juego.
        if re.search(r'\b(?:texto|inscripcion|frase|detalle visual|superficie)\b', normalized_label(label)):
            scope = 'asset:' + entry['sourceId']
        return ('safety' if SAFETY.search(normalized_label(label)) else 'product'), 'visual_observation', scope
    production_path = re.search(r'\$\.(?:shots|scenes|outputs)\[', entry['locator'])
    production = bool(PRODUCTION.search(normalized_label(label)) or production_path or field == 'custom:packaging_vigente')
    if production:
        shot = re.search(r'\$\.(?:shots|scenes|outputs)\[\d+\]', entry['locator'])
        return 'production', 'nominal', (f"asset:{entry['sourceId']}:{shot[0]}" if shot else scope)
    safety = bool(SAFETY.search(normalized_label(label)))
    if safety:
        cert = re.search(r'\b(certificacion|conformidad|ensayos|certification|conforms)\b', normalized_label(label))
        return 'safety', 'certified_claim' if cert else 'declared', scope
    # Identidad/material declarado no se vuelve nominal por una advertencia general de la ficha.
    ordinary = {'name', 'brand', 'custom:modelo', 'custom:ean_gtin_13', 'custom:edad_minima',
                'custom:material', 'custom:fabricante', 'custom:persona_responsable',
                'custom:pais_fabricacion', 'custom:lote'}
    if field in ordinary:
        # Reserva explícita en la afirmación o en su registro; nunca por párrafos ajenos.
        explicit_nominal = (NOMINAL.search(normalized_label(label + ' ' + value)) or
                            re.search(r'\.status:\s*"(?:Diseño 3D|Nominal|Provisional)', context, re.I))
        return 'product', 'nominal' if explicit_nominal else 'declared', scope
    return 'product', 'nominal' if NOMINAL.search(combined) else 'declared', scope


def citation_record(entry, status, reason=None):
    record = {key: entry[key] for key in ('sourceId', 'sourceVersion', 'fragmentId', 'locator', 'excerpt')}
    record.update(evidence_metadata(entry))
    record.update(citationId=stable_id('citation_', record), supportStatus=status)
    if reason:
        record['reason'] = REASONS[reason]
    if entry.get('recovered'):
        record['recovered'] = True
    if entry.get('contextEvidence'):
        record['contextEvidence'] = entry['contextEvidence']
    return record
