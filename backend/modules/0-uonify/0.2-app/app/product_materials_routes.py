"""API compartida por conversación y editor; iniciar no aplica atributos ni modifica originales."""
from uuid import UUID
from fastapi import APIRouter, Request, Response
from pydantic import Field
from .onboarding import StrictBody, require_user
from .security import require_origin
from .product_materials_consent import (
    MATERIAL_START_CONSENT_VERSION, MATERIAL_START_CONSENT_TEXT, MATERIAL_START_CONSENT_SHA256,
)
from .product_materials_control_consent import advertised_control_consent
from .products import find
from .products import fail


class MaterialsJobBody(StrictBody):
    requestId: UUID = Field(strict=False)
    revision: int = Field(ge=1)
    folderId: str = Field(pattern=r'^[A-Za-z0-9_-]{1,200}$')
    reanalysisOf: UUID | None = Field(default=None, strict=False)
    consentVersion: str | None = Field(default=None, max_length=64)
    consentText: str | None = Field(default=None, max_length=4000)
    consentSha256: str | None = Field(default=None, max_length=64)


class MaterialsControlBody(StrictBody):
    requestId: UUID = Field(strict=False)
    revision: int = Field(ge=1)
    acknowledgeUnknownConsumption: bool = False
    consentVersion: str | None = Field(default=None, max_length=64)
    consentText: str | None = Field(default=None, max_length=4000)
    consentSha256: str | None = Field(default=None, max_length=64)


def routes(settings, database, service):
    router = APIRouter(prefix='/api/products')

    @router.get('/{sku}/materials')
    def get_materials(sku: str, request: Request):
        with database.connect() as c:
            return service.get(c, require_user(c, request), sku)

    @router.get('/{sku}/materials/start-consent')
    def start_consent_version(sku: str, request: Request, response: Response):
        response.headers['Cache-Control'] = 'no-store'
        with database.connect() as c:
            user = require_user(c, request)
            find(c, user, sku)
        return {'version': MATERIAL_START_CONSENT_VERSION,
                'text': MATERIAL_START_CONSENT_TEXT,
                'sha256': MATERIAL_START_CONSENT_SHA256}

    @router.get('/{sku}/materials/jobs/{job_id}')
    def get_job(sku: str, job_id: str, request: Request):
        with database.connect() as c:
            return service.get(c, require_user(c, request), sku, job_id)

    @router.get('/{sku}/materials/jobs/{job_id}/control-consent/{action}')
    def control_consent_version(sku: str, job_id: str, action: str, request: Request, response: Response):
        response.headers['Cache-Control'] = 'no-store'
        if action not in ('upgrade-readers', 'repair-evidence'):
            fail('materials_not_found', 'No se encuentra esta acción.', 404)
        with database.connect() as c:
            service.get_row(c, require_user(c, request), sku, job_id)
        return advertised_control_consent(action.replace('-', '_'))

    @router.post('/{sku}/materials/jobs')
    def start_job(sku: str, body: MaterialsJobBody, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            user = require_user(c, request)
            job = service.start(c, user, sku, body.revision, body.folderId,
                                body.requestId, body.reanalysisOf,
                                consent_version=body.consentVersion,
                                consent_text=body.consentText,
                                consent_sha256=body.consentSha256)
            response = service.get(c, user, sku, job['id'])
        return response

    @router.post('/{sku}/materials/jobs/{job_id}/pause')
    def pause_job(sku: str, job_id: str, body: MaterialsControlBody, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            return service.control(c, require_user(c, request), sku, job_id, 'pause', body.revision, body.requestId)

    @router.post('/{sku}/materials/jobs/{job_id}/resume')
    def resume_job(sku: str, job_id: str, body: MaterialsControlBody, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            return service.control(c, require_user(c, request), sku, job_id, 'resume', body.revision,
                                   body.requestId, body.acknowledgeUnknownConsumption)

    @router.post('/{sku}/materials/jobs/{job_id}/reconcile')
    def reconcile_job(sku: str, job_id: str, body: MaterialsControlBody, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            return service.reconcile(c, require_user(c, request), sku, job_id, body.revision, body.requestId)

    @router.post('/{sku}/materials/jobs/{job_id}/upgrade-readers')
    def upgrade_readers(sku: str, job_id: str, body: MaterialsControlBody, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            return service.upgrade_readers(c, require_user(c, request), sku, job_id, body.revision,
                                          body.requestId, body.acknowledgeUnknownConsumption,
                                          consent_version=body.consentVersion, consent_text=body.consentText,
                                          consent_sha256=body.consentSha256)

    @router.post('/{sku}/materials/jobs/{job_id}/repair-evidence')
    def repair_evidence(sku: str, job_id: str, body: MaterialsControlBody, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            return service.repair_evidence(c, require_user(c, request), sku, job_id, body.revision,
                                          body.requestId, body.acknowledgeUnknownConsumption,
                                          consent_version=body.consentVersion, consent_text=body.consentText,
                                          consent_sha256=body.consentSha256)

    return router
