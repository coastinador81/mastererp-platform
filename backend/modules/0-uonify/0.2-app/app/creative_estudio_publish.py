"""Estudio ADK · publicar_estudio — ESQUELETO del patrón de confirmación a prueba de modelo. SIN CABLEAR.

Aplica a la PUBLICACIÓN el mismo patrón que el Gate 1 del gasto (creative_estudio_spend): el modelo solo
PROPONE; el acto que publica es una RUTA DEL CLIENTE que exige un token de un solo uso que solo tiene la
UI. Mapea sobre el ledger §D ya existente (AMZ-04): `amazon_publish_ledger.approve_exact` registra el
consentimiento del cuerpo EXACTO con `acknowledged` puesto por el SERVIDOR, sin enviar todavía a Amazon;
`amazon_publish_snapshots.present_snapshot`/`load` dan la vista previa sellada; `load_approval` da el
estado. El envío real a Amazon es un paso §D posterior, no vive aquí.

Patrón (idéntico a Gate 1):
- `preparar_publicacion` (herramienta del MODELO): presenta la revisión EXACTA ya preparada (card-safe)
  y emite un TOKEN de un solo uso SOLO a la UI (`clientConfirmation`), NUNCA al modelo. NO publica.
- `confirmar_publicacion` (RUTA DEL CLIENTE, jamás herramienta del modelo): con el token de la UI + la
  revisión sellada vigente, llama a `approve_exact` con `acknowledged=True` puesto por el SERVIDOR. El
  modelo no tiene token ni herramienta de publicación → no puede fabricar el OK. Idempotente.
- `estado_publicacion` (herramienta del MODELO, solo lectura): estado de la aprobación, card-safe.

DOS COSTURAS que se cablean DESPUÉS (por eso «sin cablear»; NO se registra en el agente, NO hay migración
nueva todavía):
  (1) §D de ArtCraft — «pieza del Estudio → revisión de Amazon»: ArtCraft prepara la fila de
      `amazon_publish_snapshots` a partir de la pieza generada (su adaptador §D). Aquí se toma el
      `snapshot_id` que ese adaptador produjo; este módulo NO crea la revisión.
  (2) Persistencia de confirmaciones de publicación: tabla `creative_estudio_publish_confirmations`
      (análoga a la 133 del gasto), un solo uso por `used_at` write-once. Su MIGRACIÓN (número a
      coordinar con ArtCraft) se añade AL CABLEAR; hoy no se aplica, así que las rutas con BD no se
      ejercitan en el chequeo del esqueleto.

Card-safe (D-PROTECCION-INGENIERIA-INVERSA, regla 1): ni hashes (payload/snapshot/schema sha), ni
`sellerId`, ni `actorId`, ni `productId` interno, ni el payload/atributos crudos salen al modelo o al
navegador. La tarjeta muestra el nombre llano del producto (el `item_name` del cliente), su sku, el
marketplace y la validación local; los hashes/revisión se quedan en el SERVIDOR para `approve_exact`.
"""
from uuid import NAMESPACE_URL, uuid5

from .amazon_publish_ledger import approve_exact, load_approval
from .amazon_publish_snapshots import load as load_snapshot
from .creative_generation_ledger import _active_user
from .products import fail

# Reparto del toolset (documentación del contrato del wiring; NO se registra hoy). confirmar_publicacion
# queda FUERA del toolset del modelo (como confirmar_creacion en el gasto): es ruta del cliente.
MODEL_PUBLISH_TOOLS = ('preparar_publicacion', 'estado_publicacion')
CLIENT_ROUTE_PUBLISH_TOOLS = ('confirmar_publicacion',)

# Tabla de confirmaciones (COSTURA 2). La migración se añade al cablear; número a coordinar con ArtCraft.
_CONFIRMATIONS = 'creative_estudio_publish_confirmations'


def _card_safe_publish_preview(snapshot_view, token=None):
    """Regla 1: SOLO lo que pinta la tarjeta de publicación. Oculta hashes, sellerId, productId y el
    payload/atributos crudos. `snapshotId` es un handle (uuid), como `quoteId` en el gasto. El token, si
    se incluye, va aparte en `clientConfirmation` (solo-UI), nunca en `card`. Los TEXTOS llano y la
    etiqueta del marketplace salen de las maquetas (owner-UX)."""
    preview = snapshot_view.get('preview', {})
    return {'snapshotId': snapshot_view['snapshotId'],
            'title': preview.get('title'),
            'sku': snapshot_view.get('sku'),
            'marketplace': snapshot_view.get('marketplaceId'),
            'localValidation': preview.get('localValidation'),
            'mediaReadiness': preview.get('mediaReadiness'),
            'limitations': preview.get('limitations', [])}


def _card_safe_publish_approval(approval):
    """Regla 1: solo el handle y el estado; nada de hashes/sellerId/actorId/revisión. `submissionReady`
    es hoy False (el envío a Amazon es un paso §D posterior); el estado llano lo pone la tarjeta."""
    estado = 'enviada' if approval.get('submissionReady') else 'aprobada'
    return {'publicationId': approval['approvalId'], 'estado': estado}


def _issue_publish_confirmation(c, user, snapshot_view):
    """COSTURA 2 (persistencia). Emite (o reusa, idempotente) el token atado a la revisión SELLADA
    (snapshot_hash), un token por snapshot. Mismo patrón que el gasto. La tabla la crea la migración que
    se añade al cablear; sin ella, esta ruta no se ejercita en el chequeo del esqueleto."""
    from secrets import token_urlsafe
    token = token_urlsafe(32)
    row = c.execute(f'''INSERT INTO {_CONFIRMATIONS}
        (user_id, snapshot_id, token, snapshot_hash, product_sku)
        VALUES(%s,%s,%s,%s,%s)
        ON CONFLICT (user_id, snapshot_id) DO NOTHING RETURNING token''',
        (user['id'], snapshot_view['snapshotId'], token,
         snapshot_view['snapshotHash'], snapshot_view['sku'])).fetchone()
    if not row:
        row = c.execute(f'''SELECT token FROM {_CONFIRMATIONS}
            WHERE user_id=%s AND snapshot_id=%s''',
            (user['id'], snapshot_view['snapshotId'])).fetchone()
    return row['token']


def preparar_publicacion(c, user, sku, snapshot_id):
    """Herramienta del MODELO: presenta la revisión EXACTA ya preparada por §D (ArtCraft) y emite el
    token de confirmación. NO publica. Devuelve DOS partes CARD-SAFE: `card` (lo que ve el modelo y pinta
    la tarjeta) y `clientConfirmation` (SOLO para la UI: token + snapshotId). El runtime del agente debe
    dar al modelo solo `card` y el token solo a la UI (el after_tool_callback del wiring lo separa)."""
    user = _active_user(c, user)
    snapshot_view = load_snapshot(c, user, sku, snapshot_id)   # §D present_snapshot; hashes server-side
    token = _issue_publish_confirmation(c, user, snapshot_view)
    return {'card': _card_safe_publish_preview(snapshot_view),
            'clientConfirmation': {'confirmationToken': token,
                                   'snapshotId': snapshot_view['snapshotId']}}


def confirmar_publicacion(c, user, sku, snapshot_id, confirmation_token):
    """RUTA DEL CLIENTE (no herramienta del modelo): con el token que la UI tiene de la tarjeta, aprueba
    la revisión EXACTA. Verifica token + revisión sellada vigente + un solo uso; el SERVIDOR pone
    `acknowledged=True` y relee los hashes/revisión del snapshot (nunca vienen del modelo). Idempotente
    (request_id determinista → un retry legítimo devuelve la misma aprobación, sin doble publicación)."""
    user = _active_user(c, user)
    conf = c.execute(f'''SELECT snapshot_id, snapshot_hash FROM {_CONFIRMATIONS}
        WHERE user_id=%s AND snapshot_id=%s AND token=%s FOR UPDATE''',
        (user['id'], snapshot_id, confirmation_token)).fetchone()
    if not conf:
        fail('creative_publish_confirmation_invalid', 'Confirmación de publicación no válida.', 409)
    # Relee la revisión sellada en el SERVIDOR: los hashes/revisión salen de aquí, no del modelo/cliente.
    snapshot_view = load_snapshot(c, user, sku, snapshot_id)
    if snapshot_view['snapshotHash'] != conf['snapshot_hash']:
        fail('creative_publish_stale', 'La revisión ha cambiado; prepárala otra vez.', 409)
    if not snapshot_view['preview'].get('sourceCurrent'):
        fail('creative_publish_stale', 'La revisión ha cambiado; prepárala otra vez.', 409)
    # Marca el token como usado una sola vez (en un retry, 0 filas → no reintenta el write-once).
    c.execute(f'''UPDATE {_CONFIRMATIONS} SET used_at=now()
        WHERE user_id=%s AND snapshot_id=%s AND used_at IS NULL''', (user['id'], snapshot_id))
    request_id = uuid5(NAMESPACE_URL, 'creative-estudio-publish:' + str(snapshot_id))
    approval = approve_exact(c, user, sku, request_id, snapshot_id,
                             snapshot_view['productRevision'], snapshot_view['payloadHash'],
                             snapshot_view['snapshotHash'], True)   # acknowledged lo pone el SERVIDOR
    return _card_safe_publish_approval(approval)


def estado_publicacion(c, user, sku, approval_id):
    """Herramienta del MODELO (SOLO lectura): estado de la publicación para la tarjeta. No publica, no
    dispara nada. Card-safe: solo el handle y el estado."""
    user = _active_user(c, user)
    approval = load_approval(c, user, sku, approval_id)   # 404 si no es suya
    return _card_safe_publish_approval(approval)
