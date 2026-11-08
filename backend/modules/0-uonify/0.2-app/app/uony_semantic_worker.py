"""Fenced Drive execution helpers shared by the worker and the voice route.

QA-03 («Consultor google», 21-10-2026): the written interpreter left this
module (WrittenSemanticAccounting deleted); no written order is classified.
"""
from hashlib import sha256
from time import monotonic
from .google_cloud_provider import CloudError
from .uony_semantic_work_status import status_reply
from .uony_drive_instruction import resolve_folder
from . import uony_drive_scope as drive_scope

# Audit F0.2/§4 (20-10-2026): reading the documents of a folder needs the typed
# read intent and its scope; a phrase alone no longer starts an analysis.

def _server_scope(worker, user, job, body, operation, kind, target):
    # Server-resolved metadata keeps an auditable scope too (audit F0.1, 4).
    with worker.database.connect() as c:
        worker.validate(c, job, body)
        drive_scope.emit(c, user['id'], job['request_id'], operation, kind, target,
                         source='server_metadata')


def _typed_drive(worker, user, job, body, context, status, operation):
    """A typed spoken Drive request: its scope came with the admission."""
    if worker.materials is None or status.get('drive') != 'connected':
        context.connection_actions.show({'provider': 'drive'})
        return 'Conecta Google Drive para que pueda comprobar tus carpetas.'
    if operation == 'access':
        worker.materials.drive.probe_access(_drive_token(worker, user, job, body, context))
        return 'Sí, puedo consultar tu Drive.'
    with worker.database.connect() as c:
        worker.validate(c, job, body)
        scope = drive_scope.load(c, user['id'], job['request_id'])
    if scope is None or scope['operation'] != operation:
        return 'Esa petición sobre tu Drive ha caducado. Vuelve a pedírmela, por favor.'
    if operation == 'count':
        try:
            count = worker.materials.drive.count_folders(_drive_token(worker, user, job, body, context))
        except CloudError as error:
            if error.code != 'incomplete_search':
                raise
            return ('No puedo confirmar un total exacto de carpetas: '
                    'Google Drive devolvió un listado incompleto.')
        return f'{count} carpetas visibles, sin papelera.'
    return None  # list or read: the agent works only inside the scope.


def resolve_request(worker, user, job, body, context, status, selected_folder,
                    semantic, handoff):
    """Server-side Drive answers for typed voice requests and interpreter
    decisions only. A written order is never parsed here: it reaches the
    agent, which asks for its scope with request_drive_scope («Consultor
    google», F0: one written path, no regex and no phrase-started analysis)."""
    if handoff and handoff['intent'] == 'drive_request':
        return _typed_drive(worker, user, job, body, context, status, handoff['drive_operation'])
    if semantic and semantic.action == 'work_status':
        with worker.database.connect() as c:
            worker.validate(c, job, body)
            return status_reply(c, user, job, body, semantic)
    if semantic and semantic.action == 'clarify':
        return semantic.clarification or '¿Qué necesitas que haga y sobre qué carpeta?'
    if semantic and semantic.action == 'conversation' and handoff:
        raise CloudError('invalid_response')
    if semantic:
        context['semanticDecision'] = {'action': semantic.action,
            'currentRequest': semantic.current_request,
            'rule': 'No afirmes que una tarea se ejecuta si no existe un resultado de herramienta.'}
        if semantic.action == 'creative_plan':
            context['liveHandoffIntent'] = 'creative_plan'
    directive = semantic.drive_instruction() if semantic else None
    if not directive or directive.action not in ('access', 'count_folders', 'search'):
        # Reading or analysing goes to the agent inside a server-emitted scope;
        # an old analyze decision on voice therefore runs without any scope.
        return None
    if semantic and semantic.action.startswith('drive_'):
        from .uony_semantic_recovery_store import admit, initial_attempt, begin_effect
        with worker.database.connect() as c:
            worker.validate(c, job, body)
            recovered = c.execute('''SELECT 1 FROM uony_semantic_requests
                WHERE user_id=%s AND business_request_id=%s''',
                (user['id'], job['request_id'])).fetchone()
            if not recovered:
                admit(c, user, job['request_id'], job['request_id'], initial_attempt(job['request_id']),
                      settings=worker.settings)
            begin_effect(c, user, job, body, settings=worker.settings)
    if worker.materials is None:
        return 'Drive no está disponible ahora mismo.'
    if status.get('drive') != 'connected':
        context.connection_actions.show({'provider': 'drive'})
        return 'Conecta Google Drive para que pueda comprobar tus carpetas.'
    if directive.action not in ('access', 'count_folders') and not (
            directive.folder_id or directive.folder_name or directive.use_selected):
        return ('¿Qué carpeta de Drive quieres que busque? '
                'Puedes decirme su nombre o pegar su enlace.')
    drive_token = _drive_token(worker, user, job, body, context)
    if directive.action == 'access':
        worker.materials.drive.probe_access(drive_token)
        return ('Sí, puedo consultar tu Drive.' if semantic else
                'Ya puedo consultar tu Drive. ¿Qué quieres que busque o analice?')
    if directive.action == 'count_folders':
        _server_scope(worker, user, job, body, 'count', 'account', None)
        try:
            count = worker.materials.drive.count_folders(drive_token)
        except CloudError as error:
            if error.code != 'incomplete_search':
                raise
            return ('No puedo confirmar un total exacto de carpetas: '
                    'Google Drive devolvió un listado incompleto. '
                    'Si quieres, dime una carpeta concreta y cuento las que contiene.')
        return (f'{count} carpetas visibles, sin papelera.'
                if semantic else f'Google Drive devuelve {count} carpetas visibles '
                'para tu cuenta conectada, sin contar la papelera. '
                'Las unidades compartidas pueden requerir una consulta aparte.')
    folder, question = resolve_folder(worker.materials.drive, drive_token, directive, selected_folder)
    if question:
        return question
    _server_scope(worker, user, job, body, 'list', 'folder', {'id': folder['id'], 'driveId': None})
    return (f'Encontré la carpeta «{folder["name"]}» en tu Drive. '
            'Dime si quieres que lea sus documentos.')


def _credential_fingerprints(rows):
    return [(row.get('google_subject'), row.get('project_id'), row.get('status'),
             row.get('connected_at'), sha256(row['refresh_encrypted'].encode()).hexdigest())
            for row, _ in rows]


def validate_drive_result(worker, c, user, job, context):
    if 'driveReadCredentials' not in context:
        return
    rows = worker.materials.credentials(c, user, refresh=False,
                                       expected_project_id=job['project_id'])
    if _credential_fingerprints(rows) != context['driveReadCredentials']:
        raise CloudError('google_changed')


def _drive_token(worker, user, job, body, context):
    # No user/job lock is held across OAuth, pagination, probe or folder lookup.
    with worker.database.connect() as c:
        worker.validate(c, job, body)
        rows = worker.materials.credentials(c, user, refresh=False,
                                           expected_project_id=job['project_id'])
    row = rows[0][0]
    context['driveReadCredentials'] = _credential_fingerprints(rows)
    cache_key = (str(user['id']), 'google_drive_connections',
                 sha256(row['refresh_encrypted'].encode()).hexdigest())
    cached = worker.materials._tokens.get(cache_key)
    if cached and cached[0] > monotonic():
        token = cached[1]
    else:
        token = worker.materials.drive.refresh(worker.materials.cipher.decrypt(
            row['refresh_encrypted'].encode()).decode())
        if len(worker.materials._tokens) >= 256:
            worker.materials._tokens.clear()
        worker.materials._tokens[cache_key] = (monotonic() + 240, token)
    with worker.database.connect() as c:
        worker.validate(c, job, body)
        validate_drive_result(worker, c, user, job, context)
    return token
