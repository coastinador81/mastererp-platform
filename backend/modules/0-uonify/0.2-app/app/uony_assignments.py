"""Persistent customer goals and explicit focus, without executing a tool."""
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import Field
from psycopg.types.json import Jsonb

from .access import workspace_access
from .onboarding import StrictBody, require_user
from .security import require_origin


class CreateAssignment(StrictBody):
    requestId: UUID = Field(strict=False)
    threadId: str = Field(min_length=1, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')
    label: str = Field(min_length=1, max_length=80)
    objective: str = Field(min_length=1, max_length=500)
    productId: UUID | None = Field(default=None, strict=False)
    intakeId: UUID | None = Field(default=None, strict=False)


class SelectAssignment(StrictBody):
    requestId: UUID = Field(strict=False)
    assignmentId: UUID = Field(strict=False)
    expectedVersion: int = Field(ge=0)


def _error(code, message, status=409):
    return HTTPException(status, detail={'error': code, 'message': message})


def _access(c, request):
    user = require_user(c, request)
    if not user.get('onboarding_completed_at') or workspace_access(c, user)['status'] != 'allowed':
        raise _error('access_required', 'Activa tu acceso a Uonify para consultar tus encargos.', 403)
    return user


def _thread(c, user, thread_id, lock=False):
    row = c.execute('''SELECT deleted_at FROM uony_threads
        WHERE user_id=%s AND id=%s''' + (' FOR UPDATE' if lock else ''),
        (user['id'], thread_id)).fetchone()
    if not row:
        raise _error('thread_not_found', 'No encontramos esta conversación en tu cuenta.', 404)
    if row['deleted_at']:
        raise _error('thread_deleted', 'Esta conversación se ha eliminado.', 410)


def _assignment(c, user, identifier):
    row = c.execute('''SELECT * FROM uony_assignments WHERE user_id=%s AND id=%s
        AND google_subject=%s''', (user['id'], identifier, user['google_subject'])).fetchone()
    if not row:
        raise _error('assignment_not_found', 'No encontramos este encargo en tu cuenta.', 404)
    return row


def _dto(row, material_status=None):
    status, next_step = row['status'], row['next_step']
    # A material job advances only the analysis stage. In particular, ready
    # never completes the customer's broader goal or authorizes another action.
    if material_status and (status, next_step) == ('pending', 'clarify_source'):
        status, next_step = {
            'queued': ('in_progress', 'check_work'),
            'running': ('in_progress', 'check_work'),
            'paused': ('pending', 'check_work'),
            'error': ('failed', 'check_work'),
            'ready': ('pending', 'review_result'),
            'stale_revision': ('pending', 'select_folder'),
        }.get(material_status, (status, next_step))
    return {'id': str(row['id']), 'label': row['label'], 'objective': row['objective'],
            'status': status, 'nextStep': next_step, 'version': row['version'],
            'productId': str(row['product_id']) if row['product_id'] else None,
            'intakeId': str(row['intake_id']) if row['intake_id'] else None,
            'createdAt': row['created_at'].isoformat(),
            'updatedAt': row['updated_at'].isoformat()}


def _dtos(c, user, rows):
    """Project the latest causal job in one bounded read for list/focus views."""
    if not rows:
        return []
    statuses = c.execute('''SELECT DISTINCT ON (link.assignment_id)
        link.assignment_id,j.status,j.revision,j.product_id,j.intake_id,j.folder_id,
        p.revision AS product_revision,i.folder_id AS intake_folder_id
        FROM uony_assignment_material_jobs AS link
        JOIN product_material_jobs AS j ON j.user_id=link.user_id
            AND j.id=link.material_job_id
            AND j.product_id IS NOT DISTINCT FROM link.product_id
            AND j.intake_id IS NOT DISTINCT FROM link.intake_id
            AND j.google_subject=link.google_subject
        LEFT JOIN products AS p ON p.user_id=j.user_id AND p.id=j.product_id
            AND p.deleted_at IS NULL
        LEFT JOIN uony_product_intakes AS i ON i.user_id=j.user_id
            AND i.id=j.intake_id AND i.google_subject=j.google_subject
        WHERE link.user_id=%s AND link.google_subject=%s
            AND link.assignment_id=ANY(%s)
        ORDER BY link.assignment_id,link.created_at DESC,link.material_job_id DESC''',
        (user['id'], user['google_subject'], [row['id'] for row in rows])).fetchall()
    by_id = {row['assignment_id']: (row['status'] if
              (row['product_id'] and row['revision'] == row['product_revision']) or
              (row['intake_id'] and row['folder_id'] == row['intake_folder_id'])
              else 'stale_revision')
             for row in statuses}
    return [_dto(row, by_id.get(row['id'])) for row in rows]


def _create_scope(body):
    return {'productId': str(body.productId) if body.productId else None,
            'intakeId': str(body.intakeId) if body.intakeId else None}


def _same_create(row, user, body):
    scope = row.get('origin_scope')
    same_scope = (scope == _create_scope(body) if scope is not None else
                  row['product_id'] == body.productId and row['intake_id'] == body.intakeId)
    return (row['google_subject'] == user['google_subject'] and
            row['origin_thread_id'] == body.threadId and
            row['label'] == body.label and row['objective'] == body.objective and
            same_scope)


def _reference(c, user, product_id, intake_id):
    if product_id:
        product = c.execute('''SELECT id FROM products WHERE user_id=%s AND id=%s
            AND deleted_at IS NULL''', (user['id'], product_id)).fetchone()
        if not product:
            raise _error('product_not_found', 'La ficha indicada no pertenece a tu cuenta.', 404)
    if intake_id:
        intake = c.execute('''SELECT product_id FROM uony_product_intakes
            WHERE user_id=%s AND id=%s AND google_subject=%s''',
            (user['id'], intake_id, user['google_subject'])).fetchone()
        if not intake:
            raise _error('intake_not_found', 'La preparación indicada no pertenece a tu cuenta.', 404)
        if product_id and intake['product_id'] != product_id:
            raise _error('assignment_reference_conflict',
                         'La preparación indicada no corresponde a esa ficha.')


def _focus(c, user, thread_id):
    row = c.execute('''SELECT * FROM uony_assignment_focus WHERE user_id=%s AND thread_id=%s''',
                    (user['id'], thread_id)).fetchone()
    if row and row['google_subject'] != user['google_subject']:
        raise _error('account_changed', 'La identidad de esta conversación ha cambiado.')
    return row


def focus_snapshot(c, user, thread_id):
    """A missing focus is a pinned choice too: later selection must not change a queued turn."""
    row = _focus(c, user, thread_id)
    return (row['assignment_id'], row['version']) if row else (None, 0)


def _focus_dto(c, user, row):
    if not row:
        return {'version': 0, 'current': None, 'previous': None}
    current = _assignment(c, user, row['assignment_id'])
    previous = _assignment(c, user, row['previous_assignment_id']) if row['previous_assignment_id'] else None
    items = _dtos(c, user, [current] + ([previous] if previous else []))
    return {'version': row['version'], 'current': items[0],
            'previous': items[1] if previous else None,
            'updatedAt': row['updated_at'].isoformat()}


def _linked_product(c, user, assignment):
    """Only an explicit product or same-identity intake may supply a product."""
    product_id = assignment['product_id']
    if not product_id and assignment['intake_id']:
        intake = c.execute('''SELECT product_id FROM uony_product_intakes
            WHERE user_id=%s AND id=%s AND google_subject=%s AND status='linked' ''',
            (user['id'], assignment['intake_id'], user['google_subject'])).fetchone()
        product_id = intake['product_id'] if intake else None
    if not product_id:
        return None
    return c.execute('''SELECT id,sku,data->>'name' AS name,revision FROM products
        WHERE user_id=%s AND id=%s AND deleted_at IS NULL FOR SHARE''',
        (user['id'], product_id)).fetchone()


def _current_product_work(c, user, product):
    """A product link proves scope; the current revision prevents stale progress."""
    row = c.execute('''SELECT kind,id,status,updated_at FROM (
        SELECT 'materials'::text AS kind,id,status,updated_at
        FROM product_material_jobs WHERE user_id=%s AND google_subject=%s
            AND product_id=%s AND revision=%s
        UNION ALL
        SELECT 'reasoning'::text AS kind,id,status,updated_at
        FROM product_reasoning_jobs WHERE user_id=%s AND google_subject=%s
            AND product_id=%s AND (revision=%s OR applied_revision=%s)
    ) jobs ORDER BY updated_at DESC,id DESC LIMIT 1''',
        (user['id'], user['google_subject'], product['id'], product['revision'],
         user['id'], user['google_subject'], product['id'], product['revision'],
         product['revision'])).fetchone()
    return ({'id': str(row['id']), 'kind': row['kind'], 'status': row['status'],
             'updatedAt': row['updated_at'].isoformat(),
             'scope': 'linked_product_current_revision'} if row else None)


def _has_earlier_product_work(c, user, product):
    row = c.execute('''SELECT EXISTS (
        SELECT 1 FROM product_material_jobs WHERE user_id=%s AND google_subject=%s
            AND product_id=%s AND revision<%s
        UNION ALL
        SELECT 1 FROM product_reasoning_jobs WHERE user_id=%s AND google_subject=%s
            AND product_id=%s AND coalesce(applied_revision,revision)<%s
    ) AS present''',
        (user['id'], user['google_subject'], product['id'], product['revision'],
         user['id'], user['google_subject'], product['id'], product['revision'])).fetchone()
    return row['present']


def _assignment_material_work(c, user, assignment, product):
    """Only the start-time relation proves that this goal initiated a job."""
    row = c.execute('''SELECT j.id,j.status,j.revision,j.product_id,j.intake_id,
        j.folder_id,j.updated_at,i.folder_id AS intake_folder_id
        FROM uony_assignment_material_jobs AS link
        JOIN product_material_jobs AS j ON j.user_id=link.user_id
            AND j.id=link.material_job_id
            AND j.product_id IS NOT DISTINCT FROM link.product_id
            AND j.intake_id IS NOT DISTINCT FROM link.intake_id
            AND j.google_subject=link.google_subject
        LEFT JOIN uony_product_intakes AS i ON i.user_id=j.user_id
            AND i.id=j.intake_id AND i.google_subject=j.google_subject
        WHERE link.user_id=%s AND link.assignment_id=%s AND link.google_subject=%s
        ORDER BY link.created_at DESC,link.material_job_id DESC LIMIT 1''',
        (user['id'], assignment['id'], user['google_subject'])).fetchone()
    if not row:
        return None
    return {'id': str(row['id']), 'kind': 'materials', 'status': row['status'],
            'productId': str(row['product_id']) if row['product_id'] else None,
            'intakeId': str(row['intake_id']) if row['intake_id'] else None,
            'revision': row['revision'],
            'currentRevision': bool((product and product['id'] == row['product_id']
                                    and product['revision'] == row['revision']) or
                                    (row['intake_id'] and assignment['intake_id'] == row['intake_id']
                                     and row['folder_id'] == row['intake_folder_id'])),
            'updatedAt': row['updated_at'].isoformat(),
            'scope': 'started_for_assignment'}


def _return_item(c, user, assignment):
    product = _linked_product(c, user, assignment)
    work = _current_product_work(c, user, product) if product else None
    assignment_work = _assignment_material_work(c, user, assignment, product)
    earlier_work = _has_earlier_product_work(c, user, product) if product and not work else False
    # This is the latest work of the linked product, not a claim that the goal
    # created it. A future assignment-job relation can narrow the scope.
    material_status = (assignment_work['status'] if assignment_work['currentRevision']
                       else 'stale_revision') if assignment_work else None
    return {'assignment': _dto(assignment, material_status),
            'product': {'id': str(product['id']), 'name': product['name'] or product['sku'],
                        'revision': product['revision']} if product else None,
            'work': work,
            'assignmentWork': assignment_work,
            'relatedProductWork': work if work and (not assignment_work or
                                   work['id'] != assignment_work['id']) else None,
            'workLabel': ('Análisis iniciado para este encargo' if assignment_work['currentRevision']
                          else 'Análisis de este encargo en una revisión anterior') if assignment_work
                         else 'Trabajo guardado de la ficha vinculada' if work
                         else 'Trabajo guardado de una revisión anterior' if earlier_work
                         else 'Guardado, sin trabajo iniciado'}


def routes(settings, database):
    router = APIRouter()

    @router.post('/assignments')
    def create(body: CreateAssignment, request: Request, response: Response):
        require_origin(request, settings.origin)
        response.headers['Cache-Control'] = 'no-store'
        with database.connect() as c:
            user = _access(c, request)
            previous = c.execute('''SELECT * FROM uony_assignments
                WHERE user_id=%s AND origin_request_id=%s''',
                (user['id'], body.requestId)).fetchone()
            if previous:
                if not _same_create(previous, user, body):
                    raise _error('assignment_request_conflict',
                                 'Esta solicitud corresponde a otro encargo.')
                return {'assignment': _dtos(c, user, [previous])[0], 'replayed': True}
            _thread(c, user, body.threadId, lock=True)
            _reference(c, user, body.productId, body.intakeId)
            row = c.execute('''INSERT INTO uony_assignments
                (user_id,id,google_subject,origin_request_id,origin_thread_id,label,
                 objective,product_id,intake_id,origin_scope)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (user_id,origin_request_id) DO NOTHING RETURNING *''',
                (user['id'], uuid4(), user['google_subject'], body.requestId,
                 body.threadId, body.label, body.objective,
                 body.productId, body.intakeId, Jsonb(_create_scope(body)))).fetchone()
            if row:
                return {'assignment': _dto(row), 'replayed': False}
            previous = c.execute('''SELECT * FROM uony_assignments
                WHERE user_id=%s AND origin_request_id=%s''',
                (user['id'], body.requestId)).fetchone()
            if not previous or not _same_create(previous, user, body):
                raise _error('assignment_request_conflict',
                             'Esta solicitud corresponde a otro encargo.')
            return {'assignment': _dtos(c, user, [previous])[0], 'replayed': True}

    @router.get('/assignments')
    def list_assignments(request: Request, response: Response):
        response.headers['Cache-Control'] = 'no-store'
        with database.connect() as c:
            user = _access(c, request)
            rows = c.execute('''SELECT * FROM uony_assignments
                WHERE user_id=%s AND google_subject=%s
                ORDER BY updated_at DESC,id DESC LIMIT 101''',
                (user['id'], user['google_subject'])).fetchall()
            return {'assignments': _dtos(c, user, rows[:100]),
                    'hasMore': len(rows) > 100}

    @router.get('/assignments/{assignment_id}')
    def read_assignment(assignment_id: UUID, request: Request, response: Response):
        response.headers['Cache-Control'] = 'no-store'
        with database.connect() as c:
            user = _access(c, request)
            return {'assignment': _dtos(c, user, [_assignment(c, user, assignment_id)])[0]}

    @router.get('/threads/{thread_id}/assignment-focus')
    def read_focus(thread_id: str, request: Request, response: Response):
        response.headers['Cache-Control'] = 'no-store'
        with database.connect() as c:
            user = _access(c, request)
            _thread(c, user, thread_id)
            return {'focus': _focus_dto(c, user, _focus(c, user, thread_id))}

    @router.put('/threads/{thread_id}/assignment-focus')
    def select(thread_id: str, body: SelectAssignment, request: Request, response: Response):
        require_origin(request, settings.origin)
        response.headers['Cache-Control'] = 'no-store'
        with database.connect() as c:
            user = _access(c, request)
            _thread(c, user, thread_id, lock=True)
            assignment = _assignment(c, user, body.assignmentId)
            prior = c.execute('''SELECT * FROM uony_assignment_focus_requests
                WHERE user_id=%s AND request_id=%s''',
                (user['id'], body.requestId)).fetchone()
            if prior:
                if (prior['thread_id'] != thread_id or prior['google_subject'] != user['google_subject'] or
                    prior['assignment_id'] != body.assignmentId or
                    prior['expected_version'] != body.expectedVersion):
                    raise _error('assignment_request_conflict',
                                 'Esta solicitud corresponde a otra selección.')
                # A delayed HTTP retry must not tell a client to display an old
                # focus after a different tab has selected another assignment.
                return {'focus': _focus_dto(c, user, _focus(c, user, thread_id)),
                        'replayed': True,
                        'outcome': {'assignmentId': str(prior['assignment_id']),
                                    'appliedVersion': prior['applied_version']}}
            current = _focus(c, user, thread_id)
            version = current['version'] if current else 0
            if version != body.expectedVersion:
                raise _error('assignment_focus_conflict',
                             'El encargo de esta conversación cambió. Actualiza antes de elegir otro.')
            previous_id = (current['previous_assignment_id'] if current and
                           current['assignment_id'] == body.assignmentId else
                           current['assignment_id'] if current else None)
            if current and current['assignment_id'] != body.assignmentId:
                version += 1
                c.execute('''UPDATE uony_assignment_focus
                    SET assignment_id=%s,previous_assignment_id=%s,version=%s,updated_at=now()
                    WHERE user_id=%s AND thread_id=%s''',
                    (body.assignmentId, previous_id, version, user['id'], thread_id))
            elif not current:
                version = 1
                c.execute('''INSERT INTO uony_assignment_focus
                    (user_id,thread_id,google_subject,assignment_id)
                    VALUES(%s,%s,%s,%s)''',
                    (user['id'], thread_id, user['google_subject'], body.assignmentId))
            c.execute('''INSERT INTO uony_assignment_focus_requests
                (user_id,request_id,thread_id,google_subject,assignment_id,
                 expected_version,applied_version,previous_assignment_id)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s)''',
                (user['id'], body.requestId, thread_id, user['google_subject'],
                 body.assignmentId, body.expectedVersion, version, previous_id))
            focus = _focus_dto(c, user, _focus(c, user, thread_id))
            return {'focus': focus, 'replayed': False}

    @router.get('/threads/{thread_id}/assignment-focus/previous')
    def previous(thread_id: str, request: Request, response: Response):
        """Resolve only an explicit focus predecessor or a sole saved goal."""
        response.headers['Cache-Control'] = 'no-store'
        with database.connect() as c:
            user = _access(c, request)
            _thread(c, user, thread_id)
            focus = _focus(c, user, thread_id)
            if focus and focus['previous_assignment_id']:
                row = _assignment(c, user, focus['previous_assignment_id'])
                return {'resolution': 'resolved', 'assignment': _dtos(c, user, [row])[0],
                        'options': [], 'moreAvailable': False}
            rows = c.execute('''SELECT * FROM uony_assignments
                WHERE user_id=%s AND google_subject=%s
                ORDER BY updated_at DESC,id DESC LIMIT 3''',
                (user['id'], user['google_subject'])).fetchall()
            if len(rows) == 1:
                return {'resolution': 'resolved', 'assignment': _dtos(c, user, rows)[0],
                        'options': [], 'moreAvailable': False}
            return {'resolution': 'ambiguous' if rows else 'none', 'assignment': None,
                    'options': _dtos(c, user, rows[:2]), 'moreAvailable': len(rows) > 2}

    @router.get('/threads/{thread_id}/assignment-return')
    def return_assignments(thread_id: str, request: Request, response: Response):
        """Bounded local snapshot; opening the chat never schedules work."""
        response.headers['Cache-Control'] = 'no-store'
        with database.connect() as c:
            user = _access(c, request)
            _thread(c, user, thread_id)
            focus = _focus(c, user, thread_id)
            if not focus and c.execute('''SELECT 1 FROM uony_creative_plans
                WHERE user_id=%s AND google_subject=%s AND thread_id=%s LIMIT 1''',
                (user['id'], user['google_subject'], thread_id)).fetchone():
                return {'resolution': 'none', 'focusVersion': 0,
                        'assignments': [], 'moreAvailable': False}
            rows = []
            if focus:
                rows.append(_assignment(c, user, focus['assignment_id']))
                if focus['previous_assignment_id']:
                    rows.append(_assignment(c, user, focus['previous_assignment_id']))
            recent = c.execute('''SELECT * FROM uony_assignments
                WHERE user_id=%s AND google_subject=%s
                ORDER BY updated_at DESC,id DESC LIMIT 3''',
                (user['id'], user['google_subject'])).fetchall()
            seen = {row['id'] for row in rows}
            for row in recent:
                if len(rows) == 2:
                    break
                if row['id'] not in seen:
                    rows.append(row)
                    seen.add(row['id'])
            total = c.execute('''SELECT count(*) AS count FROM uony_assignments
                WHERE user_id=%s AND google_subject=%s''',
                (user['id'], user['google_subject'])).fetchone()['count']
            return {'resolution': 'focused' if focus else 'single' if len(rows) == 1
                    else 'ambiguous' if rows else 'none',
                    'focusVersion': focus['version'] if focus else 0,
                    'assignments': [_return_item(c, user, row) for row in rows],
                    'moreAvailable': total > len(rows)}

    return router
