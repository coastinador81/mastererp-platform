"""Estudio ADK · Gate 2 (condición 2 del veredicto 20261022-VEREDICTO-HERRAMIENTAS-UONY-ESTUDIO-ADK).

La resolución de Elementos por NOMBRE la hace el MODELO (A8) contra la lista que entrega
`listar_elementos`; el servidor NO lleva listas de palabras. Aquí el servidor VALIDA los ids que el
modelo resolvió, fail-closed: cada id debe ser un Elemento del usuario (+proyecto) y sus referencias
deben ser propiedad verificada (owned+allowed) por el mismo criterio del gate §H.3. Un id ajeno,
inventado o con una referencia no-propia → se rechaza. La ambigüedad (mismo nombre) la resuelve el
modelo preguntando (owner-UX); aquí solo se valida el id ya resuelto.
"""
from uuid import UUID

from .creative_generation_ledger import _active_user
from .products import fail


def _scope_ok(row_project, project_id):
    # Un Elemento sirve si es GLOBAL (uonify_project_id NULL) o del proyecto pedido.
    return row_project is None or project_id is None or str(row_project) == str(project_id)


def listar_elementos(c, user, project_id=None):
    """SOLO lectura, keyed por user_id (+proyecto). Devuelve la biblioteca para que el MODELO reconozca
    los Elementos por su nombre (A8) y la tarjeta los muestre. CARD-SAFE (D-PROTECCION-INGENIERIA-INVERSA
    regla 1/2): SOLO id (handle del propio elemento del cliente), tipo y nombre — NUNCA rutas, hashes,
    voz/consentimiento ni secretos (esos se usan en GENERACIÓN, server-side, no en el listado)."""
    user = _active_user(c, user)
    rows = c.execute('''SELECT id, type, name, uonify_project_id
        FROM creative_elements WHERE user_id=%s ORDER BY name''', (user['id'],)).fetchall()
    return [{'id': str(r['id']), 'type': r['type'], 'name': r['name']}
            for r in rows if _scope_ok(r['uonify_project_id'], project_id)]


def validate_element_ids(c, user, element_ids, project_id=None):
    """SERVER-INTERNAL (NO es herramienta del modelo): valida en servidor los ids que el modelo resolvió
    por nombre (cond. 2), fail-closed, y devuelve las entradas OWNED (uri gs://, generation, sha256) para
    construir la petición de generación por el gate §H.3. Esa salida (uri/sha/generation) es interna y
    NUNCA debe llegar al modelo ni al navegador (D-PROTECCION-INGENIERIA-INVERSA regla 1): la consume el
    pipeline de generación en servidor. id ajeno/inventado/no-uuid → creative_element_not_found; ref no
    owned+allowed → creative_element_input_not_owned."""
    user = _active_user(c, user)
    if not isinstance(element_ids, (list, tuple)):
        fail('creative_element_invalid', 'Lista de elementos no válida.', 422)
    seen, validated = set(), []
    for raw in element_ids:
        try:
            eid = UUID(str(raw))
        except (ValueError, TypeError, AttributeError):
            fail('creative_element_not_found', 'Ese elemento no es tuyo o no existe.', 409)
        if eid in seen:
            continue
        seen.add(eid)
        el = c.execute('''SELECT id, type, name, is_real_person, consent_input_id, uonify_project_id
            FROM creative_elements WHERE user_id=%s AND id=%s''', (user['id'], eid)).fetchone()
        if not el or not _scope_ok(el['uonify_project_id'], project_id):
            fail('creative_element_not_found', 'Ese elemento no es tuyo o no existe.', 409)
        if el['type'] == 'character' and el['is_real_person'] and not el['consent_input_id']:
            fail('creative_element_consent_required', 'Falta el consentimiento de una persona real.', 409)
        refs = c.execute('''SELECT position, input_id FROM creative_element_references
            WHERE user_id=%s AND element_id=%s ORDER BY position''', (user['id'], eid)).fetchall()
        if not refs:
            fail('creative_element_no_references', 'Ese elemento no tiene imágenes de referencia.', 409)
        inputs = []
        for ref in refs:
            owned = c.execute('''SELECT sha256, storage_bucket, storage_name, storage_generation,
                authorization_state, mime_type FROM creative_owned_inputs
                WHERE user_id=%s AND id=%s''', (user['id'], ref['input_id'])).fetchone()
            if not owned or owned['authorization_state'] != 'allowed':
                fail('creative_element_input_not_owned', 'Una imagen del elemento no es un recurso propio verificado.', 409)
            inputs.append({'inputId': str(ref['input_id']), 'sha256': owned['sha256'],
                           'uri': f"gs://{owned['storage_bucket']}/{owned['storage_name']}",
                           'generation': owned['storage_generation'], 'mimeType': owned['mime_type']})
        validated.append({'id': str(eid), 'type': el['type'], 'name': el['name'], 'inputs': inputs})
    return validated
