"""§6/§H para CLIPS-ONLY (motor 090): gate de PROPIEDAD de ENTRADA + resolución assetId→sha256 al cotizar.

CAMBIO DE INVARIANTE del gate de admisión del motor 090 (vuelve a Consultor + REA con su PROPIO veredicto).
El motor 084 (creative_generation_ledger._verify_inputs_owned, llave uri+generation+sha256) YA tiene este
gate, pero clips-only corre en el motor 090 (creative_clips_only_admission / creative_execution_ledger:
persist_composite_quote → approve_composite_quote → hold → admit), que HOY NO verifica propiedad de entrada.
Ésta es la elevación que faltaba. ALCANCE ACOTADO: este módulo NO modifica el ledger 090 compartido
(persist_composite_quote sigue igual) ⇒ el camino de MONTAJE no se toca; el gate es clips-only y lo invoca la
cotización clips-only ANTES de persistir/aprobar (antes de todo gasto/POST).

POR QUÉ NO COPIA EL GATE DE 084: para clips-only la foto de referencia va INLINE (bytesBase64Encoded;
verificado en código por Consultor/ArtCraft/REA), así que el manifest 090 garantiza SOLO sha256 (sin
uri/generation que usar como llave). La propiedad se verifica por CONTENIDO: (user_id, sha256,
authorization_state='allowed') contra creative_owned_inputs (132). Es consistente con el fingerprint
_request (user_id,sha256) y con el cruce por sha256 de bind_google_owned_inputs (congelado). DEFENSA EN
PROFUNDIDAD: si un item ADEMÁS declara uri/generation (entrada GCS futura, no el primer clip inline), se EXIGE
que casen EXACTO con la identidad GCS de la fila owned (≥ fuerza del gate 084). Fail-closed:
ClipsOnlyInputGateError, que el camino de cotización/admisión mapea a HTTP 409 `creative_input_not_owned`
(contrato exacto del 084). El módulo queda sin acoplamiento HTTP (como el resto de clips-only), testeable puro.

C3 (contrato del Consultor): el cliente SOLO maneja el assetId OPACO (ClipInputAssetRef); el sha256 vive en
servidor (D-PROTECCIÓN). El manifest DURABLE debe llevar sha256 para fingerprint + bind + resolver. El paso
assetId→sha256 ocurre SERVER-SIDE al construir el manifest/cotizar: SELECT creative_owned_inputs por
(user_id, id) EXIGIENDO 'allowed'. El cliente nunca envía sha256. user-scoped + allowed-only = anti-swap en
cotización. El manifest clips-only lleva SOLO sha256 por item (coherente con el cuerpo INLINE); la identidad
GCS (bucket/name/generation) permanece en creative_owned_inputs y la reconstruye el resolver de DESPACHO
(creative_clips_only_owned_input.clips_only_resolve_input_receipts) por sha256.

STAGED + INERTE: SQL puro sobre la conexión `c` inyectada; sin red; no lo llama nada vivo (lo cablea la
cotización clips-only en la fase de cableado de interfaz). FOR SHARE bloquea la fila owned durante la txn de
cotización (no se puede revocar en carrera), igual que el gate 084.
"""
from __future__ import annotations

import json
import re
from urllib.parse import urlsplit

from .creative_execution_ledger import persist_composite_quote

_HASH = re.compile(r"[0-9a-f]{64}\Z")


class ClipsOnlyInputGateError(Exception):
    """Fail-closed: una entrada no es un recurso propio verificado y vigente.

    El camino de cotización/admisión la mapea a HTTP 409 `creative_input_not_owned` (contrato 084)."""


def clips_only_build_manifest_from_assets(c, *, owner_id: str, asset_ids: tuple) -> list:
    """C3: assetId OPACO → item de manifest con sha256, SERVER-SIDE. Por cada assetId (EN ORDEN): SELECT
    creative_owned_inputs por (user_id, id) EXIGIENDO authorization_state='allowed' FOR SHARE → item
    {'sha256': <sha>} (SOLO sha256: coherente con el cuerpo INLINE de clips-only; la identidad GCS queda en
    la tabla para el resolver de despacho). Fail-closed si algún assetId no es una fila propia 'allowed'. El
    cliente nunca aporta sha256 (lo oculta D-PROTECCIÓN)."""
    if not owner_id:
        raise ClipsOnlyInputGateError('Identidad propietaria ausente para construir el manifest.')
    manifest = []
    for asset_id in asset_ids:
        row = c.execute(
            """SELECT sha256 FROM creative_owned_inputs
               WHERE user_id=%s AND id=%s AND authorization_state='allowed' FOR SHARE""",
            (owner_id, asset_id)).fetchone()
        if not row:
            raise ClipsOnlyInputGateError('Un input no es un recurso propio verificado y vigente.')
        manifest.append({'sha256': row['sha256']})
    return manifest


def clips_only_verify_inputs_owned(c, user, manifest) -> None:
    """§H gate de ENTRADA para el motor 090 (clips-only). INVARIANTE autoritativo: se ejecuta en la
    cotización/admisión ANTES de persistir/aprobar, con independencia de cómo se construyó el manifest.

    Cada item debe ser PROPIEDAD del usuario y estar 'allowed'. Clips-only va INLINE ⇒ la llave de propiedad
    es (user_id, sha256). Defensa en profundidad: si el item declara uri/generation (entrada GCS), se exige
    que casen EXACTO con la identidad GCS de la fila owned. Fail-closed `creative_input_not_owned` (vía
    ClipsOnlyInputGateError) ANTES de cotizar/aprobar (y por tanto antes de todo gasto/POST). Manifest vacío
    (sin entradas) pasa, como en 084."""
    user_id = user.get('id') if isinstance(user, dict) else None
    if not user_id:
        raise ClipsOnlyInputGateError('Identidad propietaria ausente para el gate de entrada.')
    for item in manifest:
        sha = item.get('sha256') if isinstance(item, dict) else None
        if not isinstance(sha, str) or not _HASH.fullmatch(sha):
            raise ClipsOnlyInputGateError('Una entrada no trae un sha256 de contenido válido.')
        row = c.execute(
            """SELECT storage_bucket,storage_name,storage_generation FROM creative_owned_inputs
               WHERE user_id=%s AND sha256=%s AND authorization_state='allowed' FOR SHARE""",
            (user_id, sha)).fetchone()
        if not row:
            raise ClipsOnlyInputGateError('Una entrada no es un recurso propio verificado y vigente.')
        # Defensa en profundidad: si el item declara identidad GCS, DEBE casar con la fila owned (≥ 084).
        uri = item.get('uri') if isinstance(item, dict) else None
        generation = item.get('generation') if isinstance(item, dict) else None
        if uri is not None or generation is not None:
            parsed = urlsplit(uri) if isinstance(uri, str) else None
            name = parsed.path.lstrip('/') if parsed else None
            if (not parsed or parsed.scheme != 'gs' or not parsed.netloc or not name
                    or parsed.query or parsed.fragment or parsed.path.endswith('/')
                    or parsed.netloc != row['storage_bucket'] or name != row['storage_name']
                    or not isinstance(generation, int) or isinstance(generation, bool)
                    or generation != row['storage_generation']):
                raise ClipsOnlyInputGateError(
                    'La identidad GCS declarada no casa con el recurso propio verificado.')


def issue_clips_only_quote(c, user, issue_request_id, readiness, snapshots) -> dict:
    """COLOCACIÓN del §H gate en la EMISIÓN de la cotización, en la MISMA txn (condición 2 del Consultor).

    Persiste la cotización clips-only (persist_composite_quote: valida el scope — bloquea users → plans →
    google_cloud_connections FOR SHARE — e inserta el recibo idempotente) y, en la MISMA transacción, verifica
    la PROPIEDAD de cada entrada (clips_only_verify_inputs_owned, FOR SHARE sobre creative_owned_inputs). El
    manifest que se verifica es EXACTAMENTE el persistido (snapshots.input_manifest_json), no uno aparte.

    ORDEN DE LOCK (anti-deadlock): users → plans → google_cloud_connections (de la validación) ANTES de
    creative_owned_inputs (gate), igual que el gate del motor 084 (user/activo primero, luego owned_inputs FOR
    SHARE). INVARIANTE para quien construya la REVOCACIÓN (hoy no existe ningún UPDATE allowed→revoked): ese
    UPDATE DEBE bloquear al dueño (users) ANTES de creative_owned_inputs para conservar este orden y no provocar
    deadlock con la emisión.

    FAIL-CLOSED: si una entrada no es propia + 'allowed' ⇒ ClipsOnlyInputGateError y TODA la txn (incluido el
    INSERT de la cotización) revierte — no queda cotización para un input no-propio, ANTES de toda aprobación/
    gasto/POST. NO modifica persist_composite_quote (compartido con el camino de MONTAJE): el gate es clips-only
    y vive aquí. El caller (ruta/worker, cableado de interfaz) envuelve esto en su txn y mapea
    ClipsOnlyInputGateError → HTTP 409 `creative_input_not_owned` (contrato 084)."""
    view = persist_composite_quote(c, user, issue_request_id, readiness, snapshots)
    try:
        manifest = json.loads(snapshots.input_manifest_json)
    except (TypeError, AttributeError, json.JSONDecodeError):
        raise ClipsOnlyInputGateError('El manifiesto de entrada persistido no es JSON válido.') from None
    if not isinstance(manifest, list):
        raise ClipsOnlyInputGateError('El manifiesto de entrada persistido no es una lista.')
    clips_only_verify_inputs_owned(c, user, manifest)
    return view
