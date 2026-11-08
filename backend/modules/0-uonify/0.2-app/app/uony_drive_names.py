"""Drive names the customer writes, against the real names of their Drive.

Moved from uony_drive_scope, which re-exports every name here. Lote 6 (§6 of
docs/conocimiento/revisiones/20261021-ESPEC-LOTE6.md, «Consultor google»,
21-10-2026): a written order tolerates one typo per word and the folder/file
kind, but only over names Drive returns, never over the model's text, and
only for what the customer wrote in this message (audit F0, A1). The spoken
route keeps the exact resolution (resolve): it cannot check the resolved name
against the transcript, nor store a kind other than the one it asked for.
"""
import re
import unicodedata

from .google_drive_provider import BASE, FOLDER, file_id

MAX_CANDIDATES = 100  # Page of the full-word search: voice, and the written first step.
MAX_SEARCH_TERMS = 4
PAGE_SIZE = 50  # Written step with prefixes (typos): a second page is never guessed.
NAMED_CANDIDATES = 5  # Real names the agent may offer when it asks.
PREFIX_LETTERS = 3
TOLERANT_LETTERS = 4
FIELDS = 'nextPageToken,files(id,name,driveId,mimeType)'
# The other kind resolves only for an operation that fits it («Consultor
# google», kind tolerance): (requested kind, real kind) → operations.
CROSSING = {('file', 'folder'): ('read', 'access', 'count'),
            ('folder', 'file'): ('read', 'access')}


def normalized(text):
    """NFC, lower case, no accents, quotes or punctuation (audit F1-8)."""
    folded = unicodedata.normalize('NFKD', unicodedata.normalize('NFC', text).casefold())
    plain = ''.join(char for char in folded if not unicodedata.combining(char))
    return ' '.join(re.sub(r'[\W_]+', ' ', plain).split())


def distance(first, second):
    """Optimal string alignment distance: insertions, deletions, substitutions
    and swaps of two adjacent letters, each substring edited once at most."""
    before, row = None, list(range(len(second) + 1))
    for i in range(1, len(first) + 1):
        current = [i] + [0] * len(second)
        for j in range(1, len(second) + 1):
            current[j] = min(row[j] + 1, current[j - 1] + 1,
                             row[j - 1] + (first[i - 1] != second[j - 1]))
            if i > 1 and j > 1 and first[i - 1] == second[j - 2] and first[i - 2] == second[j - 1]:
                current[j] = min(current[j], before[j - 2] + 1)
        before, row = row, current
    return row[-1]


def word_matches(real, said):
    """One normalized word of a name against one the customer wrote (§6.2).

    A word of the name with four or more letters admits one edit; a shorter
    one, or one with digits, must be exact: «2024» is never «2025».
    """
    return real == said or (len(real) >= TOLERANT_LETTERS and real.isalpha()
                            and abs(len(real) - len(said)) <= 1 and distance(real, said) <= 1)


def words_match(real, said):
    """Two lists of words: as many, in the same order, each one tolerated."""
    return len(real) == len(said) and all(map(word_matches, real, said))


def named_in(name, words):
    """Whether the customer's own words name this resource (audit F0, A1).

    Provenance of the resource, not intent: a folder suggested by a document
    or an earlier answer is never scoped unless the customer names it in this
    request. Every word of the name, contiguous and in order, after
    normalized(), with one typo per word of four or more letters (§6.6).
    """
    target, said = normalized(name).split(), normalized(words).split()
    windows = (said[start:start + len(target)] for start in range(len(said) - len(target) + 1))
    return bool(target) and any(words_match(target, window) for window in windows)


def drive_literal(value):
    """A string literal for Drive's q syntax: \\ and ' escaped (no q injection)."""
    return "'" + value.replace('\\', '\\\\').replace("'", "\\'") + "'"


def search_terms(name, prefixes=False):
    """Up to MAX_SEARCH_TERMS words to find a name, longest first.

    Drive's `name contains` matches word prefixes and its accent handling is
    not documented, so each word goes both as written and without accents
    (QA-02): «FICHA TECNICA» still finds «Ficha técnica» through «FICHA».
    With `prefixes` (§6.3) the first three letters of every word of four or
    more letters go too, both ways, so «Provedores» still finds «Proveedores».
    The cap keeps the longest terms: with three words, or two words and an
    accent, some prefixes stay out.
    """
    words = [w for w in re.split(r'[\W_]+', name) if w] + normalized(name).split()
    if prefixes:
        words = words + [w[:PREFIX_LETTERS] for w in words
                         if len(w) >= TOLERANT_LETTERS and w.isalpha()]
    terms = []
    for word in sorted(words, key=len, reverse=True):
        if word.casefold() not in {term.casefold() for term in terms}:
            terms.append(word)
    return terms[:MAX_SEARCH_TERMS]


def resolve(drive, token, kind, name):
    """The single folder or file of this kind with this name, or a refusal.

    Exact normalized name first; otherwise a single name containing it. More
    than one candidate is never guessed: the customer is asked instead. The
    spoken route and the QA tree check: no typo nor kind tolerance.
    """
    target, terms = normalized(name), search_terms(name)
    if not target or not terms:
        return {'error': 'target_required'}
    mime = "mimeType = '" + FOLDER + "'" if kind == 'folder' else "mimeType != '" + FOLDER + "'"
    names = ' or '.join('name contains ' + drive_literal(term) for term in terms)
    data = drive.request(token, 'GET', BASE, params={
        'q': f"trashed = false and {mime} and ({names})",
        'pageSize': MAX_CANDIDATES, 'fields': 'files(id,name,driveId)',
        'supportsAllDrives': 'true', 'includeItemsFromAllDrives': 'true'})
    files = [item for item in (data.get('files') if isinstance(data, dict) else None) or ()
             if isinstance(item, dict) and isinstance(item.get('id'), str)
             and isinstance(item.get('name'), str)]
    exact = [item for item in files if normalized(item['name']) == target]
    candidates = exact or [item for item in files if target in normalized(item['name'])]
    if len(candidates) != 1:
        return {'error': 'target_ambiguous' if candidates else 'target_not_found'}
    drive_id = candidates[0].get('driveId')
    # The name is metadata of the resource the customer named (QA-01): the
    # agent needs its id to read it; never any content.
    return {'id': file_id(candidates[0]['id']), 'name': candidates[0]['name'],
            'driveId': file_id(drive_id) if isinstance(drive_id, str) else None}


def _named_files(drive, token, terms, size):
    """One files.list by name over both kinds (no mime filter): pairs of
    (normalized name, item) and whether Drive holds more than this page."""
    clauses = ' or '.join('name contains ' + drive_literal(term) for term in terms)
    data = drive.request(token, 'GET', BASE, params={
        'q': f'trashed = false and ({clauses})', 'pageSize': size, 'fields': FIELDS,
        'supportsAllDrives': 'true', 'includeItemsFromAllDrives': 'true'})
    data = data if isinstance(data, dict) else {}
    files = data.get('files') if isinstance(data.get('files'), list) else []
    found = [(normalized(item['name']), item) for item in files if isinstance(item, dict)
             and all(isinstance(item.get(key), str) for key in ('id', 'name', 'mimeType'))]
    return found, bool(data.get('nextPageToken')) or len(files) > size


def _first_tier(found, target, typos):
    """(tier, items) of the first tier with any item: the exact normalized
    name, then names containing it and, with `typos`, one edit per word."""
    said = target.split()
    tiers = {'exact': lambda listed: listed == target,
             'contains': lambda listed: target in listed}
    if typos:
        tiers['tolerant'] = lambda listed: words_match(listed.split(), said)
    for tier, matches in tiers.items():
        items = [item for listed, item in found if matches(listed)]
        if items:
            return tier, items
    return None, []


def resolve_named(drive, get_token, operation, kind, name, words):
    """The folder or file the customer named in `words`, for a written order.

    The model's name must be in the customer's words before any token or
    Drive call (A1). Two steps over both kinds («Consultor google», 21-10):
    the full words first, where the exact name or a single one containing it
    decides whatever page follows, so the exact name always wins; only if
    they find nothing, the prefixes for one typo per word (§6.2), never
    guessed past one page. Two or more candidates, counted over both kinds,
    are asked with their real names. The other kind only for an operation
    that fits it. The result carries the real kind, which the scope must
    store (ScopeGuard reads it).
    """
    if not named_in(name, words):
        return {'error': 'target_not_in_order'}
    target, token = normalized(name), get_token()
    # Full words, as the exact resolution: what they find decides, any page.
    found, _ = _named_files(drive, token, search_terms(name), MAX_CANDIDATES)
    tier, candidates = _first_tier(found, target, typos=False)
    paged = False
    if not candidates:  # Only then the prefixes, whose wider net asks past a page.
        found, paged = _named_files(drive, token, search_terms(name, prefixes=True), PAGE_SIZE)
        tier, candidates = _first_tier(found, target, typos=True)
    if paged or len(candidates) > 1:
        return {'error': 'target_ambiguous',
                'candidates': [item['name'] for item in candidates[:NAMED_CANDIDATES]]}
    if not candidates:
        return {'error': 'target_not_found'}
    item = candidates[0]
    # A1 again (§6.6) on what Drive matched: the real name, or, when it only
    # contains the model's name, those words, already checked above.
    if tier != 'contains' and not named_in(item['name'], words):
        return {'error': 'target_not_in_order'}
    real_kind = 'folder' if item['mimeType'] == FOLDER else 'file'
    if real_kind != kind and operation not in CROSSING.get((kind, real_kind), ()):
        # A folder to list asked for as a file never gets here: typed requests
        # only pair a file with read.
        return {'error': 'target_is_file' if real_kind == 'file' else 'target_not_found'}
    drive_id = item.get('driveId')
    return {'id': file_id(item['id']), 'name': item['name'],
            'driveId': file_id(drive_id) if isinstance(drive_id, str) else None, 'kind': real_kind}
