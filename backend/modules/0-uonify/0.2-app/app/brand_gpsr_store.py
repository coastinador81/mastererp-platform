"""Persistencia (STAGED, NO ACTIVA) de la entidad «GPSR por marca».

Espejo de app/products.py para el perfil GPSR de marca: crear/editar con control de revisión
e HISTORIAL fechado, buscar la activa, presentarla y borrado lógico. Guarda la forma camelCase
del frontend (BrandGpsrProfile); la validación de forma la aporta gpsr_capture (fuente única) y
la traducción a la forma canónica snake de product_gpsr.py la hace amazon_gpsr_adapter.

AWAITS (1): las tablas brand_gpsr / brand_gpsr_revisions NO están aplicadas todavía
(migration_drafts/132_brand_gpsr_DRAFT.sql). Hasta aplicarlas con OK del dueño, estas funciones
no pueden ejecutarse contra la BD. Importar el módulo es seguro (no toca la BD al importarse) y
HOY no lo usa nadie: no hay ruta API, porque exponerlo es decisión de UX del dueño
(D-UX-OWNER-DEFINES). Al activar: aplicar 132 -> enganchar product_gpsr_gate.load_brand_gpsr a
find_active -> añadir la ruta que defina la UX.
"""
from uuid import uuid4
from psycopg.types.json import Jsonb
from .products import fail, require_access
from .gpsr_capture import validate_brand_gpsr_capture


def present(row):
    """Forma de salida del perfil de marca (sin campos internos crudos), como products.present."""
    return {**row['data'], 'brand': row['brand'], 'id': str(row['id']), 'revision': row['revision'],
            'createdAt': int(row['created_at'].timestamp() * 1000),
            'updatedAt': int(row['updated_at'].timestamp() * 1000)}


def find_active(connection, user, brand):
    """Perfil GPSR activo de una marca del usuario, o None. (product_gpsr_gate.load_brand_gpsr
    devolverá `find_active(...)['data']` cuando se aplique la migración.)"""
    return connection.execute(
        'SELECT * FROM brand_gpsr WHERE user_id=%s AND lower(brand)=lower(%s) AND deleted_at IS NULL',
        (user['id'], brand)).fetchone()


def save(connection, user, brand, data, *, revision=None, source='editor', changed_by=None):
    """Crea o actualiza el perfil GPSR de la marca. Valida con product_gpsr (no inventa),
    controla el choque de revisión como products.py y escribe una fila de historial en la MISMA
    transacción (Legal §4.3/§4.4). Devuelve present(row)."""
    require_access(connection, user)
    brand = (brand or '').strip()
    if not brand:
        fail('invalid_brand_gpsr', 'La marca es obligatoria.')
    try:
        clean = validate_brand_gpsr_capture(data)
    except (ValueError, TypeError) as error:
        fail('invalid_brand_gpsr', str(error))
    current = find_active(connection, user, brand)
    if current:
        current = connection.execute(
            'SELECT * FROM brand_gpsr WHERE user_id=%s AND id=%s AND deleted_at IS NULL FOR UPDATE',
            (user['id'], current['id'])).fetchone()
    if current and revision is not None and revision != current['revision']:
        fail('brand_gpsr_conflict', 'El perfil GPSR de la marca ha cambiado. Revisa los cambios antes de guardar.', 409)
    if current:
        row = connection.execute(
            'UPDATE brand_gpsr SET data=%s,revision=revision+1,updated_at=now() '
            'WHERE user_id=%s AND id=%s RETURNING *', (Jsonb(clean), user['id'], current['id'])).fetchone()
    else:
        row = connection.execute(
            'INSERT INTO brand_gpsr(user_id,id,brand,data) VALUES(%s,%s,%s,%s) RETURNING *',
            (user['id'], uuid4(), brand, Jsonb(clean))).fetchone()
    connection.execute(
        'INSERT INTO brand_gpsr_revisions(user_id,brand_gpsr_id,revision,data,source,changed_by) '
        'VALUES(%s,%s,%s,%s,%s,%s)',
        (user['id'], row['id'], row['revision'], Jsonb(clean), source, changed_by))
    return present(row)


def soft_delete(connection, user, brand, *, source='delete', changed_by=None):
    """Borrado lógico del perfil GPSR de la marca. A diferencia de products.delete, NO borra el
    historial: brand_gpsr_revisions es la prueba fechada que exige la trazabilidad (Legal
    §4.3/§4.4). La purga total ocurre solo al eliminar la cuenta (flujo de account_deletion)."""
    require_access(connection, user)
    current = find_active(connection, user, brand)
    if not current:
        fail('brand_gpsr_not_found', 'No se encuentra el perfil GPSR de esta marca.', 404)
    row = connection.execute(
        'UPDATE brand_gpsr SET revision=revision+1,deleted_at=now(),updated_at=now() '
        'WHERE user_id=%s AND id=%s RETURNING *', (user['id'], current['id'])).fetchone()
    connection.execute(
        'INSERT INTO brand_gpsr_revisions(user_id,brand_gpsr_id,revision,data,source,changed_by) '
        'VALUES(%s,%s,%s,%s,%s,%s)',
        (user['id'], row['id'], row['revision'], Jsonb(row['data']), source, changed_by))
    return {'ok': True}
