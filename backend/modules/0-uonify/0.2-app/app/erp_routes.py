"""Pantallas de ERP · Finanzas con datos reales: lista y ficha de solo lectura.

GET /api/erp/{kind}?after=<cursor>&limit=<1..25>&q=<solo ventas> y GET /api/erp/{kind}/{ref}, con
kind en COLLECTIONS. Exige sesión, prueba o suscripción vigente (como Drive) y la conexión del ERP
del usuario (mastererp_store.credential_provider): el servidor pone el token, el inquilino y la
empresa, y la web solo recibe proyecciones en lista blanca con referencias y cursores opacos,
nunca un UUID ni un token. Las llamadas a la API van fuera de la transacción de la cuenta: no se
retiene ningún bloqueo mientras esperan a la red. Fallos tipados con el código de ErpError; un 401
o un identity_not_linked de la API dejan además la conexión en 'reauthorize' o 'not_linked'.
"""
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse

from . import mastererp_store as store
from .google_drive_oauth import entitled
from .mastererp_api import get_record, list_records
from .mastererp_config import load_mastererp_config
from .mastererp_refs import project_item, project_record, remember, remember_page, resolve
from .mastererp_types import COLLECTIONS, ErpError

NO_STORE = {'Cache-Control': 'no-store'}
STATUS = {'erp_reconnect': 401, 'erp_not_linked': 403, 'erp_denied': 403, 'erp_not_found': 404,
          'erp_selection_required': 409, 'erp_changed': 409, 'erp_invalid': 400, 'erp_unavailable': 503}
MESSAGES = {
    'erp_reconnect': 'Vuelve a conectar tu cuenta del ERP para seguir consultando Finanzas.',
    'erp_not_linked': 'La cuenta conectada todavía no tiene acceso a Finanzas en el ERP.',
    'erp_denied': 'Tu cuenta del ERP no tiene permiso para consultar este apartado.',
    'erp_not_found': 'Este documento ya no está disponible. Vuelve al listado para abrirlo de nuevo.',
    'erp_selection_required': 'Elige el espacio y la empresa del ERP para consultar Finanzas.',
    'erp_changed': 'La conexión con el ERP ha cambiado. Vuelve a intentarlo.',
    'erp_invalid': 'No se pudo hacer esta consulta. Vuelve al listado para intentarlo.',
    'erp_unavailable': 'No podemos consultar el ERP ahora. Puedes volver a intentarlo.',
}
_STORED = {'erp_reconnect': 'reauthorize', 'erp_not_linked': 'not_linked'}


def failed(error: ErpError) -> JSONResponse:
    return JSONResponse({'error': error.code, 'message': MESSAGES[error.code]},
                        status_code=STATUS[error.code], headers=NO_STORE)


def routes(settings, database) -> APIRouter:
    router = APIRouter(prefix='/api/erp')
    config = load_mastererp_config()

    def session(request, kind):
        """Cuenta con acceso vigente y su credencial del ERP (la transacción de la cuenta se cierra antes)."""
        with database.connect() as connection:
            user = entitled(connection, request)
        if kind not in COLLECTIONS:
            raise ErpError('erp_not_found')
        return user['id'], store.credential_provider(database, settings, user['id'])()

    def upstream(user_id, credential, call):
        try:
            return call()
        except ErpError as error:
            if error.code in _STORED:
                store.mark(database, user_id, _STORED[error.code], credential.fingerprint)
            raise

    @router.get('/{kind}')
    def page(kind: str, request: Request, after: str | None = Query(None, max_length=64),
             limit: int = Query(10), q: str | None = Query(None, max_length=1000)):
        try:
            user_id, credential = session(request, kind)
            cursor = None
            if after:
                with database.connect() as connection:
                    cursor = resolve(connection, user_id, credential, kind, after)
                if cursor is None:
                    raise ErpError('erp_invalid')  # Cursor caducado o ajeno: se vuelve a la primera página.
            data = upstream(user_id, credential, lambda: list_records(
                config, credential, kind, after=cursor, limit=limit, q=q))
            with database.connect() as connection:
                refs, following = remember_page(connection, user_id, credential, kind, data)
            items = [{'ref': ref, **project_item(kind, raw)} for ref, raw in zip(refs, data['items'])]
            return JSONResponse({'items': items, 'nextCursor': following}, headers=NO_STORE)
        except ErpError as error:
            return failed(error)

    @router.get('/{kind}/{ref}')
    def record(kind: str, ref: str, request: Request):
        try:
            user_id, credential = session(request, kind)
            with database.connect() as connection:
                record_id = resolve(connection, user_id, credential, kind, ref)
            if record_id is None:
                raise ErpError('erp_not_found')
            raw = upstream(user_id, credential, lambda: get_record(config, credential, kind, record_id))
            with database.connect() as connection:
                remember(connection, user_id, credential, kind, [raw])  # Renueva su vida de 30 minutos.
            return JSONResponse({'record': {'ref': ref, **project_record(kind, raw)}}, headers=NO_STORE)
        except ErpError as error:
            return failed(error)

    return router
