"""Recognise a customer's current Drive instruction before model generation.

This is deliberately conservative: saved chat, model output and document text
cannot create a Drive action. An ambiguous folder produces a chat question.
"""
from dataclasses import dataclass
import re
import unicodedata

from .google_drive_provider import FOLDER


_FOLDER_URL = re.compile(
    r'https://drive\.google\.com/drive/(?:u/\d+/)?folders/([A-Za-z0-9_-]{1,200})(?![A-Za-z0-9_-])',
    re.IGNORECASE,
)
_QUOTED_FOLDER = re.compile(r'\bcarpeta\s+(?:de\s+|llamada\s+)?[«"“]([^»"”]{1,120})[»"”]', re.IGNORECASE)
_DRIVE_NAMED_FOLDER = re.compile(
    r'\bcarpeta\s+(?:de\s+)?(?:google\s+)?drive\s+'
    r'(?:llamada|que\s+se\s+llama)\s+(.{1,120}?)(?=[,.!?;]|$)', re.IGNORECASE)
_NAMED_FOLDER = re.compile(
    r'\bcarpeta\s+(?:(?:de|llamada|que se llama)\s+)?(.{1,120}?)'
    r'(?=\s+(?:en|de)\s+(?:google\s+)?drive\b|[,.!?;]|$)', re.IGNORECASE)


def _plain(value):
    return ''.join(char for char in unicodedata.normalize('NFD', value.casefold())
                   if unicodedata.category(char) != 'Mn')


@dataclass(frozen=True)
class DriveInstruction:
    action: str  # access, count_folders, search, analyze
    folder_id: str | None = None
    folder_name: str | None = None
    use_selected: bool = False


def _bounded_target(command, action, has_url):
    """Reject trailing conditions or a second request after the one folder."""
    verb = re.search(r'\b(?:analiza|analice|analices)\b', command) if action == 'analyze' else re.search(
        r'\b(?:busca|busques|encuentra|encuentres|localiza)\b', command)
    if not verb:
        return False
    prefix_has_drive = bool(re.search(r'\b(?:google\s+)?drive\b', command[:verb.start()]))
    tail = command[verb.end():].strip().removesuffix('.').strip()
    if not tail:
        return False
    if has_url:
        return bool(re.fullmatch(
            r'(?:(?:(?:la|una)\s+)?carpeta\s+(?:de\s+)?|'
            r'(?:(?:(?:esta|esa|la|una)\s+)?carpeta(?:\s+(?:de\s+)?'
            r'(?:google\s+)?drive)?\s*:\s*))?'
            r'https://drive\.google\.com/drive/(?:u/\d+/)?folders/[a-z0-9_-]{1,200}/?'
            r'(?:\?[^\s,;!?#]+)?(?:\#[^\s,;!?]+)?', tail))
    if re.search(r'[,;!?\n]', tail):
        return False
    if re.fullmatch(r'(?:(?:la|mi)\s+)?(?:esta|esa)\s+carpeta(?:\s+de\s+(?:google\s+)?drive)?', tail):
        return True
    if re.fullmatch(r'(?:la|una)\s+carpeta\s+de\s+(?:google\s+)?drive', tail):
        return True
    folder = r'(?:(?:la|una|mi)\s+)?carpeta\s+(?:(?:de|llamada)\s+)?'
    named = r'[^,;!?.\n]+'
    drive_end = r'\s+(?:en|de)\s+(?:google\s+)?drive'
    if re.fullmatch(folder + named + drive_end, tail):
        return True
    if re.fullmatch(
            r'(?:(?:la|una|mi)\s+)?carpeta\s+(?:de\s+)?(?:google\s+)?'
            r'drive\s+(?:llamada|que\s+se\s+llama)\s+' + named, tail):
        return True
    if action == 'search' and re.fullmatch(named + drive_end, tail):
        return True
    return bool(prefix_has_drive and re.fullmatch(folder + named, tail)
                and not re.search(r'\bdrive\b', tail))


def _access_only(command):
    """An access check must not swallow a different requested Drive action."""
    request = re.sub(r'^¿\s*|\s*\?$', '', command.strip()).removesuffix('.').strip()
    target = r'(?:(?:mi|tu|el)\s+)?(?:cuenta\s+de\s+)?(?:google\s+)?drive'
    state = r'(?:tienes\s+(?:acceso|conexion)|estas\s+conectado)\s+(?:a|en|con)'
    patterns = (
        r'(?:necesito|quiero)\s+que\s+me\s+(?:digas|confirmes)\s+si\s+(?:ya\s+)?'
        + state + r'\s+' + target,
        r'(?:ve|entra|accede)\s+(?:a|en)\s+' + target
        + r'(?:\s+y\s+(?:avisame|dime|confirmame)'
        + r'(?:\s+cuando\s+estes\s+(?:alli|ahi)|\s+si\s+'
        + r'(?:(?:ya\s+)?tienes\s+acceso|estas\s+(?:alli|ahi)))?)?',
        r'(?:revisa|comprueba|verifica|dime|confirmame)\s+(?:si\s+)?(?:ya\s+)?'
        + r'(?:(?:tienes\s+)?(?:acceso|conexion|conectado)|'
        + r'estas\s+conectado)\s+(?:a|en|con)\s+' + target,
        r'(?:necesito|quiero)\s+saber\s+si\s+'
        + r'(?:(?:puedes|podrias)\s+(?:tener\s+acceso\s+(?:a|en)|'
        + r'(?:entrar|acceder)\s+(?:a|en))|'
        + state + r')\s+' + target,
        r'(?:puedes|podrias)\s+(?:(?:entrar|acceder|ir)\s+(?:a|en)|'
        + r'tener\s+acceso\s+(?:a|en))\s+' + target,
        r'(?:ya\s+)?' + state + r'\s+' + target,
    )
    return any(re.fullmatch(pattern, request) for pattern in patterns)


def _strip_access_repair_preface(request):
    """Remove only direct first-person conversational repair prefixes."""
    patterns = (
        r'^te\s+pregunte\s*,\s*',
        r'^simplemente\s+te\s+he\s+preguntado\s+si\s+',
        r'^te\s+estoy\s+preguntando\s+si\s+',
    )
    for pattern in patterns:
        stripped = re.sub(pattern, '', request, count=1)
        if stripped != request:
            return stripped
    return request


def _folder_count_only(command, *, drive_context=False):
    """Recognise one complete, read-only question about folder count."""
    request = re.sub(r'^¿\s*|\s*\?$', '', command.strip()).removesuffix('.').strip()
    request = re.sub(r'^una\s+pregunta\s*,\s*', '', request)
    prefix = r'(?:(?:cuenta|necesito\s+que\s+me\s+(?:digas|indiques)|quiero\s+saber|'
    prefix += r'podrias\s+(?:decirme|indicarme)|puedes\s+(?:decirme|indicarme)|'
    prefix += r'me\s+puedes\s+(?:decir|indicar)|me\s+(?:dices|indicas)|dime|indicame)\s+)?'
    count = r'(?:cuantas\s+carpetas\s+(?:hay|tengo)|'
    count += r'(?:el\s+)?numero\s+de\s+carpetas\s+(?:que\s+)?(?:hay|tengo))'
    scope = r'(?:\s+(?:en|de)\s+(?:(?:mi|tu|el)\s+)?(?:cuenta\s+de\s+)?(?:google\s+)?drive)?'
    # A polite, current request for a bounded metadata count is actionable.
    # Full matching keeps examples, conditions and extra actions outside it.
    polite_count = (r'(?:(?:necesito|quiero)\s+saber\s+si\s+)?'
                    r'(?:puedes|podrias)\s+contar\s+(?:(?:todas\s+)?las\s+|mis\s+)?'
                    r'carpetas(?:\s+que\s+(?:tengo|hay))?')
    if re.fullmatch(polite_count + scope, request):
        return bool(re.search(r'\bdrive\b', request)) or drive_context
    if drive_context and re.fullmatch(polite_count + r'\s+(?:alli|ahi)', request):
        return True
    if re.fullmatch(prefix + count + scope, request):
        return bool(re.search(r'\bdrive\b', request)) or drive_context
    # A deictic place needs bounded Drive context from the customer; an
    # unrelated topic or model answer cannot supply that context.
    return bool(drive_context and re.fullmatch(
        prefix + count + r'\s+(?:alli|ahi|en\s+(?:esa|esta)\s+cuenta)', request))


def parse_drive_instruction(text, *, selected_folder=None, drive_context=False):
    """Return only direct, scoped commands from the current customer turn."""
    if not isinstance(text, str) or not text.strip():
        return None
    original = text.strip()
    # A direct polite request for a particular folder has the same meaning as
    # an imperative. Capability questions and compound requests still fall
    # through because the entire target must match the bounded grammar below.
    polite = re.fullmatch(
        r'¿\s*(?:puedes|podrías|podrias)\s+(analizar|buscar)\b(.+?)\?\s*',
        original, re.IGNORECASE | re.DOTALL)
    # A narrow negative tail can limit a search, but cannot turn a denied
    # analysis into permission to analyse the same folder.
    restricted = re.search(
        r'[,;]\s*pero\s+no\s+(?:la\s+|lo\s+)?analic\w*\s*[.!]?$',
        original, re.IGNORECASE)
    if restricted:
        original = original[:restricted.start()]
        prefix = _plain(original)
        if (not re.search(r'\b(?:busca|encuentra|localiza)\b', prefix)
                or re.search(r'\b(?:analiza|analice|analices)\b', prefix)):
            return None
    plain = _plain(original)
    # Questions about access are read-only requests. Match the whole current
    # turn before the general question guard; a second action cannot be hidden
    # after a successful access clause.
    access_request = re.sub(
        r'^\s*(?:(?:oye|uony|wony|por favor)[,\s]+)*', '', plain)
    # A spoken conversational preface is not part of the requested action.
    # Strip this one neutral preface only for a full access-only question;
    # _access_only still rejects any appended search, analysis or deletion.
    access_request = re.sub(r'^una\s+pregunta\s*,\s*', '', access_request)
    access_request = _strip_access_repair_preface(access_request)
    if _access_only(access_request):
        return DriveInstruction('access')
    if _folder_count_only(access_request, drive_context=drive_context):
        return DriveInstruction('count_folders')
    # Only an imperative or an explicit request can start work. Questions about
    # capability, quoted commands, examples, status and later work are not
    # executable instructions. The model can answer or clarify those normally.
    if ((original.startswith('¿') and not polite)
            or re.search(r'[:“"«]\s*(?:analiza|busca)\b', plain)
            or re.search(r'\b(si yo|si te|si ya|ya has|ya habias|analizaste|buscaste|revisaste|como|cuanto cuesta|es posible|que se necesita|luego|mas tarde|despues)\b', plain)
            or re.search(r'\bcuando\s+(?:te|yo)\s+(?:diga|avise|pida)\b', plain)
            or re.search(r'\b(?:cuando\s+(?:(?:este|estes|estemos)\s+list\w*|vuelva|vuelvas)|solo\s+cuando|antes\s+de\s+(?:empezar|iniciar)|espera\s+(?:mi|a\s+que)|no\s+(?:empieces|comiences|inicies|hagas)|aun\s+no|todavia\s+no)\b', plain)
            or re.search(r'\b(?:manana|pasado\s+manana|en\s+\d+\s+(?:minutos?|horas?|dias?)|hasta\s+que|pero\s+primero|primero\s+dime|solo\s+al\s+final|al\s+final|cuando\s+yo\s+termine|en\s+cuanto\s+(?:te|yo))\b', plain)
            or re.search(r'\b(?:no|nunca|sin)\b.{0,50}\b(?:analiz|analic|busc|revis|lee|leer|leas)', plain)):
        return None
    command = (('analiza' if _plain(polite.group(1)) == 'analizar' else 'busca')
               + _plain(polite.group(2)) if polite else re.sub(
                   r'^\s*[¿?]?\s*(?:(?:oye|uony|wony|por favor)[,\s]+)*', '', plain))
    has_drive = bool(re.search(r'\b(?:google )?drive\b', plain))
    urls = {match.group(1) for match in _FOLDER_URL.finditer(original)}
    if 'drive.google.com/' in plain and not urls:
        return None
    if len(urls) > 1:
        return None
    has_folder = bool(re.search(r'\bcarpeta\b', plain))
    if not has_drive and not urls and not (has_folder and selected_folder):
        return None
    # A linked "busca y analiza" refers to one object. Other mixed actions
    # could name different resources, so they cannot launch an analysis here.
    search_verb = re.search(r'\b(?:busca|busques|encuentra|encuentres|localiza)\b', command)
    analyze_verb = re.search(r'\b(?:analiza|analice|analices|analices?)\b', command)
    if search_verb and analyze_verb and not re.search(
            r'\b(?:busca|busques|encuentra|encuentres)\s+y\s+(?:analiza|analices)\b', command):
        return None
    direct_analysis = (
        re.match(r'^(?:analiza|analice)\b', command)
        or re.match(r'^(?:busca|encuentra)\s+y\s+analiza\b', command)
        or re.match(r'^(?:ve|entra|accede)\s+(?:a|en)\s+(?:google\s+)?drive\s+y\s+(?:(?:busca|encuentra)\s+y\s+)?analiza\b', command)
        or re.match(r'^(?:quiero|necesito|te pido)\s+que\s+(?:(?:vayas|entres)\s+(?:a|en)\s+(?:google\s+)?drive\s+y\s+)?(?:(?:busques|encuentres)\s+y\s+)?analices\b', command))
    direct_search = (
        re.match(r'^(?:busca|encuentra|localiza)\b', command)
        or re.match(r'^(?:ve|entra|accede)\s+(?:a|en)\s+(?:google\s+)?drive\s+y\s+(?:busca|encuentra|localiza)\b', command)
        or re.match(r'^(?:quiero|necesito|te pido)\s+que\s+(?:busques|encuentres)\b', command))
    access_check = has_drive and _access_only(command)
    if direct_analysis:
        action = 'analyze'
    elif direct_search:
        action = 'search'
    elif access_check:
        return DriveInstruction('access')
    else:
        return None
    if action == 'search' and re.search(r'\b(documento|documentos|archivo|archivos)\b', plain):
        return None  # A folder lookup would not fulfil a file/content search.
    if not _bounded_target(command, action, bool(urls)):
        return None
    if urls:
        return DriveInstruction(action, folder_id=next(iter(urls)))
    names = []
    for pattern in (_QUOTED_FOLDER, _DRIVE_NAMED_FOLDER, _NAMED_FOLDER):
        for match in pattern.finditer(original):
            candidate = match.group(1).strip(' \t\r\n«»"“”')
            if _plain(candidate) not in ('', 'esta', 'esa', 'la', 'una', 'mi', 'mis',
                    'especifica', 'que te diga', 'que te indique', 'drive', 'google drive'):
                names.append(candidate)
        if names:
            break
    distinct = {_plain(name) for name in names}
    if len(distinct) > 1:
        return None
    name = names[0] if names else None
    if name:
        return DriveInstruction(action, folder_name=name)
    if selected_folder and has_folder:
        return DriveInstruction(action, use_selected=True)
    if action == 'search':
        # "Busca Basic Mini Bricks en Drive" need not say "carpeta".
        match = re.search(r'\b(?:busca|buscar|encuentra|localiza)\s+(.{1,120}?)\s+en\s+(?:google\s+)?drive\b', original, re.IGNORECASE)
        if match:
            name = re.sub(r'^(?:la\s+)?carpeta\s+(?:de\s+)?', '', match.group(1), flags=re.IGNORECASE).strip(' \t«»"“”')
            if name:
                return DriveInstruction(action, folder_name=name)
    return DriveInstruction(action)


def resolve_folder(drive, token, instruction, selected_folder=None):
    """Resolve one folder without guessing among names or reading content."""
    if instruction.use_selected:
        identifier = selected_folder.get('id') if isinstance(selected_folder, dict) else None
        if not identifier:
            return None, '¿Qué carpeta de Drive quieres que analice? Puedes decirme su nombre o pegar su enlace.'
        item = drive.metadata(token, identifier)
    elif instruction.folder_id:
        item = drive.metadata(token, instruction.folder_id)
    elif instruction.folder_name:
        exact = []
        page = None
        for _ in range(5):
            result = drive.files(token, search=instruction.folder_name, page=page)
            exact.extend(entry for entry in result.get('files', []) if
                         entry.get('mimeType') == FOLDER and
                         _plain(entry.get('name', '').strip()) == _plain(instruction.folder_name.strip()))
            if len(exact) > 1:
                break
            page = result.get('nextPageToken')
            if not page:
                break
        if len(exact) != 1 or page:
            if len(exact) > 1 or page:
                return None, 'Hay varias carpetas posibles. ¿Me pasas el enlace de la carpeta exacta?'
            return None, f'No encuentro la carpeta «{instruction.folder_name}» en tu Drive. ¿Me pasas su enlace?'
        item = drive.metadata(token, exact[0]['id'])
    else:
        return None, '¿Qué carpeta de Drive quieres que analice? Puedes decirme su nombre o pegar su enlace.'
    if item.get('mimeType') != FOLDER or item.get('trashed') or not item.get('id'):
        return None, 'Ese enlace no corresponde a una carpeta de Drive disponible en tu cuenta.'
    return item, None
