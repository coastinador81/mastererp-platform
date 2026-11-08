"""Misma evaluación y persistencia para editor y conversación."""
from fastapi import APIRouter, Request
from pydantic import Field
from .onboarding import StrictBody, require_user
from .security import require_origin
from .amazon_catalog import MARKETPLACE


class RequirementsConfiguration(StrictBody):
    revision: int = Field(ge=1)
    productType: str | None = Field(default=None, max_length=100)
    referenceAsin: str | None = Field(default=None, max_length=10)
    marketplaceId: str = MARKETPLACE


class RequirementsAnswers(StrictBody):
    revision: int = Field(ge=1)
    evaluationId: str = Field(min_length=64, max_length=64)
    answers: dict[str, str]
    attribute: str | None = Field(default=None, max_length=150)


class RequirementsPreparation(StrictBody):
    revision: int = Field(ge=1)
    retry: bool = False
    acknowledgeUnknown: bool = False


def routes(settings, database, service):
    router = APIRouter(prefix='/api/products')

    @router.get('/{sku}/amazon-requirements')
    def get_requirements(sku: str, request: Request, attribute: str | None = None):
        with database.connect() as c:
            return service.get_for(c, require_user(c, request), sku, attribute)

    @router.post('/{sku}/amazon-requirements')
    def configure_requirements(sku: str, body: RequirementsConfiguration, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            return service.configure_for(c, require_user(c, request), sku, body.revision,
                                         body.productType, body.referenceAsin, body.marketplaceId)

    @router.patch('/{sku}/amazon-requirements')
    def answer_requirements(sku: str, body: RequirementsAnswers, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            return service.answer_for(c, require_user(c, request), sku, body.revision,
                                      body.evaluationId, body.answers, body.attribute)

    @router.post('/{sku}/amazon-requirements/prepare')
    def prepare_requirements(sku: str, body: RequirementsPreparation, request: Request):
        from .products import find, fail
        require_origin(request, settings.origin)
        with database.connect() as c:
            user = require_user(c, request)
            if find(c, user, sku)['revision'] != body.revision:
                fail('product_conflict', 'La ficha ha cambiado. Actualízala antes de continuar.', 409)
            return service.prepare_for(c, user, sku, retry=body.retry, acknowledge_unknown=body.acknowledgeUnknown)
    return router
