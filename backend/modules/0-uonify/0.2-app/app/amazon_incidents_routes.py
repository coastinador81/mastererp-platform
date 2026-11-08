"""Consulta/sincronización desde Producto. Correcciones y aprobación usan el chat compartido."""
from fastapi import APIRouter, Request
from pydantic import Field
from .onboarding import require_user, StrictBody
from .security import require_origin
from .amazon_incidents_service import AmazonIncidents


class SyncBody(StrictBody):
    sku: str | None = Field(default=None, min_length=1, max_length=200)
    marketplaceId: str | None = Field(default=None, max_length=30)
    cursor: str | None = Field(default=None, max_length=100)


def routes(settings, database, amazon, incidents=None):
    service = incidents or AmazonIncidents(settings, database, amazon.config)
    router = APIRouter(prefix='/api/product-incidents')

    def user_id(request):
        with database.connect() as c:
            return require_user(c, request)['id']

    @router.get('')
    def listing(request: Request, sku: str | None = None, status: str = 'active', marketplaceId: str | None = None):
        return service.listing(user_id(request), sku=sku, status=status, marketplace_id=marketplaceId)

    @router.post('/sync')
    def sync(request: Request, body: SyncBody = SyncBody()):
        require_origin(request, settings.origin)
        return service.sync(user_id(request), sku=body.sku, marketplace_id=body.marketplaceId, cursor=body.cursor)

    @router.get('/{incident_id}')
    def detail(incident_id: str, request: Request):
        return {'incident': service.get(user_id(request), incident_id)}

    return router
