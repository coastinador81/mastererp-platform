"""Direct Drive orders are scoped to the current customer message."""
import pytest

from app.google_drive_provider import FOLDER
from app.uony_drive_instruction import parse_drive_instruction, resolve_folder


@pytest.mark.parametrize(('text', 'action', 'name'), [
    ('Ve a Drive y avísame cuando estés allí', 'access', None),
    ('Revisa si tienes acceso a Drive', 'access', None),
    ('Necesito saber si puedes tener acceso a mi Drive', 'access', None),
    ('¿Puedes entrar en mi cuenta de Drive?', 'access', None),
    ('Dime si tienes acceso a mi Drive', 'access', None),
    ('¿Tienes acceso a mi Google Drive?', 'access', None),
    ('Una pregunta, ¿tienes acceso a mi Drive?', 'access', None),
    ('Necesito que me digas si ya tienes acceso a mi Drive.', 'access', None),
    ('¿Ya tienes acceso a mi Drive?', 'access', None),
    ('Confírmame si ya tienes acceso a mi Drive.', 'access', None),
    ('Oye, ¿puedes acceder a mi Drive?', 'access', None),
    ('Quiero saber si estás conectado a mi Drive.', 'access', None),
    ('¿Cuántas carpetas hay en mi Drive?', 'count_folders', None),
    ('Dime cuántas carpetas tengo en Google Drive', 'count_folders', None),
    ('Indícame cuántas carpetas tengo en mi cuenta de Drive.', 'count_folders', None),
    ('¿Me puedes decir cuántas carpetas hay en mi Drive?', 'count_folders', None),
    ('Necesito que me digas cuántas carpetas hay en Drive', 'count_folders', None),
    ('Cuenta cuántas carpetas hay en mi Drive.', 'count_folders', None),
    ('Necesito saber si puedes contar las carpetas que tengo en Drive.', 'count_folders', None),
    ('¿Puedes contar mis carpetas en Drive?', 'count_folders', None),
    ('Busca la carpeta de Basic Mini Bricks en Drive', 'search', 'Basic Mini Bricks'),
    ('Busca Basic Mini Bricks en Drive', 'search', 'Basic Mini Bricks'),
    ('Ve a Drive y busca y analiza la carpeta Basic Mini Bricks', 'analyze', 'Basic Mini Bricks'),
    ('Analiza la carpeta Basic Mini Bricks en Drive', 'analyze', 'Basic Mini Bricks'),
    ('Analiza la carpeta de Drive llamada Basic Mini Bricks.', 'analyze', 'Basic Mini Bricks'),
    ('¿Puedes analizar la carpeta Basic Mini Bricks en Drive?', 'analyze', 'Basic Mini Bricks'),
    ('¿Podrías buscar la carpeta Basic Mini Bricks en Drive?', 'search', 'Basic Mini Bricks'),
    ('Quiero que analices la carpeta Basic Mini Bricks en Drive', 'analyze', 'Basic Mini Bricks'),
])
def test_direct_orders(text, action, name):
    directive = parse_drive_instruction(text)
    assert directive.action == action
    assert directive.folder_name == name


@pytest.mark.parametrize('text', [
    'Tengo fotos en Drive.',
    'No analices la carpeta Basic Mini Bricks en Drive.',
    'Si yo te digo analiza la carpeta Basic Mini Bricks en Drive, ¿lo harías?',
    '¿Qué pasaría si analizas la carpeta Basic Mini Bricks en Drive?',
    'Cuando te diga que analices la carpeta Basic Mini Bricks en Drive, lo harás.',
    'Analiza la carpeta Basic Mini Bricks en Drive cuando te avise.',
    '¿Ya analizaste la carpeta Basic Mini Bricks en Drive?',
    '¿Cómo analizarías la carpeta Basic Mini Bricks en Drive?',
    '¿Me puedes decir si ya analizaste la carpeta Basic Mini Bricks en Drive?',
    'Busca la carpeta A en Drive, pero no la analices. Analiza la carpeta B en Drive.',
    'Busca documentos en la carpeta Basic Mini Bricks de Drive.',
    '¿Es posible analizar la carpeta Basic Mini Bricks en Drive?',
    '¿Puedes analizar la carpeta Basic Mini Bricks en Drive mañana?',
    '¿Puedes analizar la carpeta Basic Mini Bricks en Drive o debo autorizarla?',
    'Dime si puedes analizar la carpeta Basic Mini Bricks en Drive.',
    'Explícame qué se necesita para analizar la carpeta Basic Mini Bricks en Drive.',
    'Revisa los permisos de la carpeta Basic Mini Bricks en Drive.',
    'Mi compañero dijo: analiza la carpeta Basic Mini Bricks en Drive.',
    'En mis notas pone “analiza la carpeta Basic Mini Bricks en Drive”.',
    'Necesito saber cuánto cuesta analizar la carpeta Basic Mini Bricks en Drive.',
    'Por ahora busca la carpeta Basic Mini Bricks en Drive y luego analízala.',
    'Analiza la carpeta B en Drive, no la del enlace https://drive.google.com/drive/folders/AAAA/',
    'Busca https://drive.google.com/drive/folders/AAAA/ y analiza la carpeta B en Drive.',
    'Analiza la carpeta Basic Mini Bricks en Drive, pero no empieces todavía.',
    'Analiza la carpeta Basic Mini Bricks en Drive cuando esté listo.',
    'Analiza la carpeta Basic Mini Bricks en Drive y avísame antes de empezar.',
    'Analiza la carpeta Basic Mini Bricks en Drive; espera mi autorización antes de comenzar.',
    'Analiza la carpeta Basic Mini Bricks en Drive solo cuando vuelva.',
    'Analiza la carpeta Basic Mini Bricks en Drive. No hagas nada aún.',
    '¿Analiza la carpeta Basic Mini Bricks en Drive?',
    'Analiza la carpeta B en Drive; el enlace es https://drive.google.com/drive/folders/AAAA.',
    'Analiza la carpeta Basic Mini Bricks en Drive mañana.',
    'Analiza la carpeta Basic Mini Bricks en Drive en 10 minutos.',
    'Analiza la carpeta Basic Mini Bricks en Drive cuando yo termine.',
    'Analiza la carpeta Basic Mini Bricks en Drive hasta que te autorice.',
    'Analiza la carpeta Basic Mini Bricks en Drive, pero primero dime el precio.',
    'Analiza la carpeta Basic Mini Bricks en Drive, pero primero dime si podrás hacerlo.',
    'Analiza la carpeta Basic Mini Bricks en Drive. Ahora cancela.',
    'Analiza la carpeta B en Drive. Enlace: https://drive.google.com/open?id=AAAA',
    'Ve a Drive y analiza la carpeta Basic Mini Bricks mañana.',
    'Ve a Drive y analiza la carpeta Basic Mini Bricks hasta que te autorice.',
    'Ve a Drive y analiza la carpeta Basic Mini Bricks pero primero dime el precio.',
    'Ve a Drive y analiza la carpeta Basic Mini Bricks solo al final.',
    'Analiza la carpeta Basic Mini Bricks en Drive, pero no la analices.',
    'Busca la carpeta Basic Mini Bricks mañana, pero no la analices.',
    'Ve a Drive y busca la carpeta Basic Mini Bricks mañana, pero no la analices.',
    'Busca y analiza la carpeta Basic Mini Bricks en Drive, pero no la analices.',
    'Ve a Drive y busca y analiza la carpeta Basic Mini Bricks, pero no la analices.',
    'Ve a Drive y borra todos mis archivos.',
    'Ve a Drive y comparte la carpeta Basic Mini Bricks.',
    'Revisa si tienes acceso a Drive y elimina la carpeta Basic Mini Bricks.',
    'Ve a Drive y dime si puedes analizar la carpeta Basic Mini Bricks.',
    'Necesito saber si puedes tener acceso a mi Drive y crear un producto.',
    '¿Puedes entrar en mi cuenta de Drive y analizar una carpeta?',
    'Dime si tienes acceso a mi Drive y borra mis archivos.',
    'Necesito que me digas si ya tienes acceso a mi Drive y borres una carpeta.',
    '¿Tienes acceso a mi Drive y puedes compartir una carpeta?',
    'Una pregunta, ¿tienes acceso a mi Drive y puedes borrar archivos?',
    'Una pregunta, ¿tienes acceso a mi Drive? Analiza una carpeta.',
    'Una pregunta, analiza la carpeta Basic Mini Bricks en Drive.',
    'acceso a mi Drive',
    'Quiero saber si puedes entrar en mi Drive; luego analizarás Basic Mini Bricks.',
    'Si puedes tener acceso a mi Drive, analiza la carpeta Basic Mini Bricks.',
    'Mi compañero preguntó: ¿Puedes entrar en mi cuenta de Drive?',
    'Necesito que me digas cuántas carpetas hay',
    'Necesito que me digas cuántas carpetas hay en Drive y las leas',
    '¿Cuántas carpetas hay en mi Drive? Luego bórralas.',
    'Cuenta cuántas carpetas hay en mi Drive y analízalas.',
    'Cuenta cuántas carpetas hay en mi Drive; después bórralas.',
    'Cuenta cuántas carpetas hay.',
    'Si puedes contar mis carpetas en Drive, hazlo mañana.',
    'Necesito saber si puedes contar las carpetas que tengo en Drive y leerlas.',
    '¿Puedes contar mis carpetas en Drive? Luego bórralas.',
    '¿Podrías indicarme cuántas carpetas tengo allí?',
])
def test_information_and_hypotheticals_are_not_authorization(text):
    assert parse_drive_instruction(text) is None


def test_folder_count_without_drive_requires_verified_context():
    directive = parse_drive_instruction(
        'Necesito que me digas cuántas carpetas hay', drive_context=True)
    assert directive.action == 'count_folders'
    assert parse_drive_instruction('¿Cuántas carpetas hay?', drive_context=True).action == 'count_folders'
    assert parse_drive_instruction('¿Podrías indicarme cuántas carpetas tengo allí?',
                                   drive_context=True).action == 'count_folders'
    for text in ('Dime cuántas carpetas tengo ahí.',
                 'Indícame cuántas carpetas hay allí.',
                 '¿Me puedes decir el número de carpetas que tengo en esa cuenta?'):
        assert parse_drive_instruction(text, drive_context=True).action == 'count_folders'
        assert parse_drive_instruction(text) is None
    assert parse_drive_instruction('¿Podrías indicarme cuántas carpetas tengo allí?') is None
    assert parse_drive_instruction('¿Podrías indicarme cuántas carpetas tengo allí y leerlas?',
                                   drive_context=True) is None
    assert parse_drive_instruction('¿Cuántas carpetas hay y cómo las analizas?',
                                   drive_context=True) is None


def test_direct_folder_url_with_standard_share_query():
    directive = parse_drive_instruction(
        'Analiza la carpeta https://drive.google.com/drive/folders/AAAA?usp=sharing')
    assert directive.action == 'analyze' and directive.folder_id == 'AAAA'


def test_direct_folder_url_after_colon():
    directive = parse_drive_instruction(
        'Analiza esta carpeta de Drive: https://drive.google.com/drive/folders/AAAA?usp=sharing')
    assert directive.action == 'analyze' and directive.folder_id == 'AAAA'


def test_selected_folder_requires_current_reference():
    selected = {'id': 'selected', 'name': 'Basic Mini Bricks'}
    directive = parse_drive_instruction('Analiza esta carpeta de Drive', selected_folder=selected)
    assert directive.action == 'analyze' and directive.use_selected
    assert parse_drive_instruction('Tengo materiales en Drive', selected_folder=selected) is None
    assert parse_drive_instruction('Analiza esta carpeta de Drive').folder_name is None


def test_negated_analysis_does_not_expand_a_search_order():
    directive = parse_drive_instruction('Busca la carpeta Basic Mini Bricks en Drive, pero no la analices')
    assert directive.action == 'search'


class FakeDrive:
    def __init__(self, files):
        self.entries = files
        self.calls = []

    def files(self, token, parent='root', page=None, search=''):
        self.calls.append(('files', token, search))
        return {'files': self.entries, 'nextPageToken': None}

    def metadata(self, token, identifier):
        self.calls.append(('metadata', token, identifier))
        return next(item for item in self.entries if item['id'] == identifier)


def test_exact_folder_only_and_no_content_download():
    drive = FakeDrive([
        {'id': 'a', 'name': 'Basic Mini Bricks backup', 'mimeType': FOLDER},
        {'id': 'b', 'name': 'Basic Mini Bricks', 'mimeType': FOLDER},
    ])
    directive = parse_drive_instruction('Analiza la carpeta Basic Mini Bricks en Drive')
    result, question = resolve_folder(drive, 'token', directive)
    assert question is None and result['id'] == 'b'
    assert [call[0] for call in drive.calls] == ['files', 'metadata']


def test_duplicate_folder_name_needs_link():
    drive = FakeDrive([
        {'id': 'a', 'name': 'Basic Mini Bricks', 'mimeType': FOLDER},
        {'id': 'b', 'name': 'Basic Mini Bricks', 'mimeType': FOLDER},
    ])
    directive = parse_drive_instruction('Analiza la carpeta Basic Mini Bricks en Drive')
    result, question = resolve_folder(drive, 'token', directive)
    assert result is None and 'enlace' in question
    assert not any(call[0] == 'metadata' for call in drive.calls)
