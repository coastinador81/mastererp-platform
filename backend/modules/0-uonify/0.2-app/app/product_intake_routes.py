"""Metadata-only intake API shared by the approved conversational controls."""
from uuid import UUID
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from pydantic import Field
from .onboarding import StrictBody, require_user
from .security import require_origin
from .google_cloud_provider import CloudError
from .product_intake import ProductIntake


class IntakeRequest(StrictBody):
    threadId: str = Field(min_length=1, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')
    revision: int = Field(ge=1)
    requestId: UUID = Field(strict=False)


class FolderRequest(IntakeRequest):
    folderId: str = Field(pattern=r'^[A-Za-z0-9_-]{1,200}$')


class ProductRequest(IntakeRequest):
    name: str = Field(min_length=1, max_length=500)


def routes(settings, database, drive):
    router = APIRouter(prefix='/api/uony/product-intakes')
    service = ProductIntake(settings, database, drive)

    def failed(error):
        messages = {'reauthorize': 'Renueva la conexión con Drive para continuar.',
            'permission_denied': 'Google no permite consultar esa carpeta. Revisa sus permisos o elige otra.',
            'invalid_file': 'La carpeta ya no está disponible. Elige otra carpeta de Drive.',
            'file_forbidden': 'El propietario o tu organización limitan el acceso a esa carpeta. Elige otra.'}
        return JSONResponse({'error': error.code, 'message': messages.get(error.code,
            'No podemos consultar esa carpeta ahora. Tu selección se conserva; puedes volver a intentarlo.'),
            'connectionActions': [{'provider': 'drive', 'action': 'manage'}] if error.code == 'reauthorize' else []},
            status_code=409 if error.code in messages else 503)

    @router.get('/{identifier}')
    def get_intake(identifier: UUID, request: Request,
                   threadId: str = Query(min_length=1, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')):
        with database.connect() as c:
            return service.get(c, require_user(c, request), identifier, threadId)

    @router.post('/{identifier}/folder')
    def folder(identifier: UUID, body: FolderRequest, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            user = require_user(c, request)
            credential = c.execute('''SELECT google_subject,refresh_encrypted FROM google_drive_connections
                WHERE user_id=%s''', (user['id'],)).fetchone()
            try:
                # Keep failed preparation atomic while persisting an expired
                # permission against precisely the credential that failed.
                with c.transaction():
                    return service.select_folder(c, user, identifier, body)
            except CloudError as error:
                if error.code == 'reauthorize' and credential:
                    c.execute('''UPDATE google_drive_connections SET status='reauthorize'
                        WHERE user_id=%s AND google_subject=%s AND refresh_encrypted=%s''',
                        (user['id'], credential['google_subject'], credential['refresh_encrypted']))
                return failed(error)

    @router.post('/{identifier}/product')
    def create_product(identifier: UUID, body: ProductRequest, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            return service.create_product(c, require_user(c, request), identifier, body)

    return router
