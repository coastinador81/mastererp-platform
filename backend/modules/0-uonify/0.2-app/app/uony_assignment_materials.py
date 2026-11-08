"""Start material work for an explicitly chosen goal, without another queue."""
from uuid import UUID

from fastapi import APIRouter, Request, Response
from pydantic import Field

from .onboarding import StrictBody
from .product_materials_consent import start_consent
from .products import find
from .security import require_origin
from .uony_assignments import _access, _dtos, _error


class AssignmentMaterialsStart(StrictBody):
    requestId: UUID = Field(strict=False)
    sku: str = Field(min_length=1, max_length=80)
    revision: int = Field(ge=1)
    folderId: str = Field(pattern=r'^[A-Za-z0-9_-]{1,200}$')
    reanalysisOf: UUID | None = Field(default=None, strict=False)
    consentVersion: str | None = Field(default=None, max_length=64)
    consentText: str | None = Field(default=None, max_length=4000)
    consentSha256: str | None = Field(default=None, max_length=64)


def _matches_assignment(c, user, assignment, product, folder_id):
    if assignment['product_id'] and assignment['product_id'] != product['id']:
        raise _error('assignment_product_conflict',
                     'Este encargo está vinculado a otra ficha. Revisa el producto antes de analizar.')
    if assignment['intake_id']:
        intake = c.execute('''SELECT status,product_id,folder_id FROM uony_product_intakes
            WHERE user_id=%s AND id=%s AND google_subject=%s''',
            (user['id'], assignment['intake_id'], user['google_subject'])).fetchone()
        if (not intake or intake['status'] != 'linked' or
                intake['product_id'] != product['id'] or intake['folder_id'] != folder_id):
            raise _error('assignment_intake_conflict',
                         'La carpeta o la ficha de este encargo cambió. Revísalas antes de analizar.')
    elif not assignment['product_id']:
        raise _error('assignment_product_required',
                     'Vincula una ficha o una preparación confirmada antes de iniciar el análisis.')


def routes(settings, database, materials):
    router = APIRouter()

    @router.get('/materials/jobs/{job_id}')
    def read_instruction_job(job_id: UUID, request: Request, response: Response):
        """Owner-bound progress for chat analysis without requiring a product SKU."""
        response.headers['Cache-Control'] = 'no-store'
        with database.connect() as c:
            user = _access(c, request)
            return materials.get_instruction_job(c, user, job_id)

    @router.post('/assignments/{assignment_id}/materials/jobs')
    def start(assignment_id: UUID, body: AssignmentMaterialsStart,
              request: Request, response: Response):
        require_origin(request, settings.origin)
        response.headers['Cache-Control'] = 'no-store'
        with database.connect() as c:
            # require_user locks this account for all product start paths. The
            # assignment lock protects its explicit product/intake binding.
            user = _access(c, request)
            assignment = c.execute('''SELECT * FROM uony_assignments WHERE user_id=%s
                AND id=%s AND google_subject=%s FOR UPDATE''',
                (user['id'], assignment_id, user['google_subject'])).fetchone()
            if not assignment:
                raise _error('assignment_not_found', 'No encontramos este encargo en tu cuenta.', 404)
            product = find(c, user, body.sku)
            previous = c.execute('''SELECT id FROM product_material_jobs
                WHERE user_id=%s AND request_id=%s''', (user['id'], body.requestId)).fetchone()
            if previous:
                link = c.execute('''SELECT assignment_id FROM uony_assignment_material_jobs
                    WHERE user_id=%s AND material_job_id=%s''',
                    (user['id'], previous['id'])).fetchone()
                if not link or link['assignment_id'] != assignment_id:
                    raise _error('assignment_material_request_conflict',
                                 'Esta solicitud de análisis pertenece a otro contexto guardado.')
            else:
                # A fresh contextual action needs the exact server-owned copy.
                # A replay keeps its original immutable receipt, even if copy changed.
                start_consent(body.consentVersion, body.consentSha256,
                              body.consentText, require_version=True)
            _matches_assignment(c, user, assignment, product, body.folderId)
            job = materials.start(c, user, body.sku, body.revision, body.folderId,
                                  body.requestId, body.reanalysisOf,
                                  consent_version=body.consentVersion,
                                  consent_text=body.consentText,
                                  consent_sha256=body.consentSha256,
                                  assignment_id=assignment_id)
            saved = c.execute('''SELECT id,request_id,product_id,google_subject
                FROM product_material_jobs WHERE user_id=%s AND id=%s''',
                (user['id'], job['id'])).fetchone()
            if not saved or saved['product_id'] != product['id'] or saved['google_subject'] != user['google_subject']:
                raise _error('assignment_material_scope_conflict',
                             'No pudimos verificar el contexto de este análisis.')
            link = c.execute('''SELECT assignment_id FROM uony_assignment_material_jobs
                WHERE user_id=%s AND material_job_id=%s''',
                (user['id'], saved['id'])).fetchone()
            if saved['request_id'] != body.requestId:
                # MaterialsService found an earlier job by product/folder/revision.
                # Reusing it is safe, but it cannot become a causal job of a new goal.
                if not link or link['assignment_id'] != assignment_id:
                    raise _error('assignment_material_existing',
                                 'Ya existe un análisis de esta carpeta para la ficha. Revisa ese resultado antes de iniciar otro.')
                reused = True
            elif link:
                if link['assignment_id'] != assignment_id:
                    raise _error('assignment_material_request_conflict',
                                 'Esta solicitud de análisis pertenece a otro encargo.')
                reused = True
            else:
                if previous:
                    raise _error('assignment_material_request_conflict',
                                 'No se puede vincular después un análisis iniciado fuera de este encargo.')
                c.execute('''INSERT INTO uony_assignment_material_jobs
                    (user_id,assignment_id,google_subject,product_id,material_job_id,origin_request_id)
                    VALUES(%s,%s,%s,%s,%s,%s)''',
                    (user['id'], assignment_id, user['google_subject'], product['id'],
                     saved['id'], body.requestId))
                if not assignment['product_id']:
                    c.execute('''UPDATE uony_assignments SET product_id=%s,
                        version=version+1,updated_at=now() WHERE user_id=%s AND id=%s''',
                        (product['id'], user['id'], assignment_id))
                reused = False
            result = materials.get(c, user, body.sku, saved['id'])
            refreshed = c.execute('''SELECT * FROM uony_assignments
                WHERE user_id=%s AND id=%s AND google_subject=%s''',
                (user['id'], assignment_id, user['google_subject'])).fetchone()
            return {**result, 'assignmentId': str(assignment_id),
                    'assignmentWorkScope': 'started_for_assignment', 'reused': reused,
                    'assignment': _dtos(c, user, [refreshed])[0]}

    return router
