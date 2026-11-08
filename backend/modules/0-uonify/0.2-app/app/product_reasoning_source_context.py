"""Reservas de originales locales por registro/fila/página, sin alterar contexto enviado ni huella."""
import re
import hashlib
from .product_materials_evidence import EvidenceIndex, NOMINAL
from .product_reasoning_context import text_units

PENDING_SECTION = re.compile(r'^(?:(?:pagina|page)\s+\d+:\s*)?(?:datos por completar|datos pendientes|pending data|missing information)\s*$', re.M)
PENDING_RECORD = re.compile(r'\.(?:status|estado):\s*["\']?(?:pending|pendiente)|'
    r'\b[a-z]\s*(?:\([^)]*\))?\s*:\s*pendiente\b|\$\.(?:missing|pending|requirements)\[')
NUMBER_WITH_UNIT = re.compile(r'\d+(?:[.,]\d+)?\s*(?:mm|cm|m|kg|mg|g|lb|oz|inch(?:es)?|kilogram\w*|gram\w*)\b|'
    r'\d+(?:[.,]\d+)?\s*[x×]\s*\d+', re.I)
ACTUAL = re.compile(r'(?:medida|peso|dimension|measurement|weight)\s+(?:real|fisic[oa]|medid[oa]|measured)|'
    r'\b(?:se ha medido|se midio|actual measurement|physically measured|medido|measured|pesado|weighed)\b', re.I)
RESERVED_DESIGN = re.compile(r'\b(?:propuest[oa]s?|proposed|pending|design 3d|3d design|nominal)\b')


def folded(value):
    import unicodedata
    return unicodedata.normalize('NFKD', str(value)).encode('ascii', 'ignore').decode().lower()


def real_measurement(text):
    text = folded(text)
    # Una petición de muestra medida o un encabezado sin cifra no es una medición observada.
    for match in ACTUAL.finditer(text):
        prefix = re.split(r'[.;\n]', text[max(0, match.start() - 55):match.start()])[-1]
        if re.search(r'pendiente|aportar|falta|solicitar|necesita|requier|debe|por medir', prefix): continue
        if NUMBER_WITH_UNIT.search(text[match.end():match.end() + 100]): return True
    return False


def direct_state(entry):
    text = folded(entry.get('text', ''))
    locator = folded(entry.get('locator', ''))
    if real_measurement(text): return None
    # Estados estructurados pertenecen únicamente a su registro o fila.
    if PENDING_RECORD.search(text) or PENDING_RECORD.search(locator): return 'pending'
    if NOMINAL.search(text) or RESERVED_DESIGN.search(text.replace('_', ' ')): return 'nominal'
    if PENDING_SECTION.search(text): return 'pending'
    return None


def attach_reconciliation_context(context, sources, fragments):
    """Solo índice interno de las unidades ya seleccionadas/omitidas; no hay red ni relectura."""
    allowed = {e['id'] for e in context.get('evidence', []) + context.get('coverage', {}).get('omittedUnits', [])}
    source_map = {str(s['id']): s for s in sources}
    eligible = []
    for fragment in fragments:
        sid = str(fragment.get('source_id', fragment.get('sourceId', '')))
        source = source_map.get(sid)
        if not source or fragment.get('state') in ('split', 'superseded'): continue
        if fragment.get('version') and source.get('version') and fragment['version'] != source['version']: continue
        eligible.append({**fragment, 'source_id': sid})
    index = EvidenceIndex(sources, eligible)
    originals = text_units(index, source_map, set(), set())
    pages = {}
    for entry in originals:
        match = re.fullmatch(r'(?:Página|Page)\s+(\d+)', entry['locator'], re.I)
        if match and entry['kind'] == 'text':
            pages[(entry['sourceId'], entry['sourceVersion'], match[1])] = entry
    states = {}
    for entry in originals:
        if entry['id'] not in allowed: continue
        state = direct_state(entry); proof = entry
        if not state:
            match = re.match(r'(?:Página|Page)\s+(\d+)\s*[·:]', entry['locator'], re.I)
            parent = pages.get((entry['sourceId'], entry['sourceVersion'], match[1])) if match else None
            if parent and not real_measurement(entry['text']):
                state = direct_state(parent); proof = parent
        if state:
            states[entry['id']] = {'state': state, 'proof': {k: proof[k] for k in ('sourceId', 'sourceVersion', 'locator')},
                                  'textFingerprint': hashlib.sha256(proof['text'].encode()).hexdigest()}
            # Prueba exacta de la reserva; no es texto regenerado por IA.
            lines = [line for line in proof['text'].splitlines() if NOMINAL.search(folded(line)) or RESERVED_DESIGN.search(folded(line).replace('_', ' ')) or
                     PENDING_SECTION.search(folded(line)) or PENDING_RECORD.search(folded(line))]
            states[entry['id']]['proof']['excerpt'] = '\n'.join(lines)[:2000]
    context['_reconciliationSourceStates'] = states
    return context
