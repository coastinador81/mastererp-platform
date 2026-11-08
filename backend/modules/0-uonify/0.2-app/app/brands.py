"""Rutas de /api/brands: perfil GPSR de marca (defaults heredables, forma camelCase
BrandGpsrProfile). La persistencia, el control de revisión y el historial fechado viven en
brand_gpsr_store; la validación de forma, en gpsr_capture. Núcleo invisible: el diseño lo hace
Frontend-app. No bloquea nada (enforce=False vive en la puerta, no aquí)."""
from fastapi import APIRouter, Request
from .onboarding import require_user
from .security import require_origin
from .products import fail
from . import brand_gpsr_store

_METADATA = ('id', 'revision', 'createdAt', 'updatedAt')


def routes(settings, database):
    router = APIRouter(prefix='/api/brands')

    @router.get('')
    def listing(request: Request):
        with database.connect() as connection:
            user = require_user(connection, request)
            rows = connection.execute(
                'SELECT * FROM brand_gpsr WHERE user_id=%s AND deleted_at IS NULL ORDER BY lower(brand)',
                (user['id'],)).fetchall()
            return {'brands': [brand_gpsr_store.present(row) for row in rows]}

    @router.get('/{brand}')
    def one(brand: str, request: Request):
        with database.connect() as connection:
            user = require_user(connection, request)
            row = brand_gpsr_store.find_active(connection, user, brand)
            if not row:
                fail('brand_gpsr_not_found', 'No se encuentra el perfil GPSR de esta marca.', 404)
            return {'brand': brand_gpsr_store.present(row)}

    @router.put('/{brand}')
    def save(brand: str, data: dict, request: Request):
        require_origin(request, settings.origin)
        if not isinstance(data, dict):
            fail('invalid_brand_gpsr', 'Revisa el perfil GPSR de la marca.')
        revision = data.get('revision')
        clean = {key: value for key, value in data.items() if key not in _METADATA}
        with database.connect() as connection:
            user = require_user(connection, request)
            return {'brand': brand_gpsr_store.save(connection, user, brand, clean,
                                                   revision=revision, changed_by=user['id'])}

    @router.delete('/{brand}')
    def remove(brand: str, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            return brand_gpsr_store.soft_delete(connection, user, brand, changed_by=user['id'])

    return router
