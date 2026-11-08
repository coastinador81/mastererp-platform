"""PUERTO 1 (adjudicado): adaptadores del input SUBIDO sobre `creative_owned_inputs` (migración 132,
APROBADA por el Consultor 22-10). Resuelve el hueco de diseño del uploader/live_provider SIN tocar 089 ni
una migración nueva — 132 es la vía 'uploaded' purpose-built (origin IN drive/upload/product_photo/generated).

ADJUDICACIÓN (ArtCraft + Consultor): el input que SUBE el cliente NO es un asset GENERADO (nada de
source_job_id sintético). Es una fila INMUTABLE de creative_owned_inputs (origin 'upload'/'product_photo',
authorization_state 'allowed'). Sin eje de revisión: cada subida = asset_id único (uuid4); re-subir corregido
= fila nueva, no rev 2. El anti-swap lo dan user_id + authorization_state='allowed' + la inmutabilidad (trigger
allowed→revoked) + UNIQUE(user_id,sha256) + UNIQUE(bucket,name,generation).

Dos adaptadores = los puertos que inyectan el uploader (asset_recorder) y el live_provider (input_receipt_resolver):
  * clips_only_record_owned_input: INSERT create-only del recibo VERIFICADO (bucket/name/generation + sha256/
    mime/byte_size del objeto real que devolvió upload_once). Idempotente por UNIQUE(user_id,sha256).
  * clips_only_resolve_input_receipts: reconstruye los StorageReceipt del request POR sha256 del input_manifest
    (en ORDEN), SOLO del DUEÑO y en authorization_state='allowed'; los pasa a bind_google_owned_inputs, que
    cruza manifest↔receipts (uri+generation+sha256 + _receipt_path). Fail-closed si falta/revocado/no-propio.

STAGED + INERTE: SQL puro sobre la conexión `c` inyectada; sin red; no lo llama nada vivo (lo cablea interfaz).
VUELVE al Consultor + REA para re-radiografiar los adaptadores reales. D-PROTECCIÓN: no expone gs://.
"""
from __future__ import annotations

import re

import psycopg

from .creative_storage_contracts import StorageReceipt

_HASH = re.compile(r"[0-9a-f]{64}\Z")
_ORIGINS_SUBIDA = ("upload", "product_photo")


class ClipsOnlyOwnedInputError(Exception):
    """Fail-closed: no se pudo registrar/recuperar el input propio verificado del cliente."""


def clips_only_record_owned_input(c, *, owner_id: str, asset_id: str, receipt: StorageReceipt,
                                  origin: str = "upload", uonify_project_id: str | None = None) -> str:
    """INSERT create-only del input subido en creative_owned_inputs (132). `receipt` = el StorageReceipt
    VERIFICADO del objeto real (upload_once). Idempotente: re-subir el mismo sha no duplica.

    DEVUELVE el asset_id EFECTIVO (fix re-subida 28-10): el id de la fila que posee ESTE contenido para
    este dueño — el recién insertado, o el EXISTENTE si el `ON CONFLICT (user_id,sha256)` dedupe por
    contenido. Antes devolvía None y la ruta devolvía el id recién minteado aunque el ON CONFLICT NO lo
    insertara → `resolve_clips_only_frame` daba 404. Ahora el llamador devuelve el id resoluble.

    Fail-closed en AMBAS llaves UNIQUE de la 132 (endurecimiento REA 27-10): `ON CONFLICT (user_id,sha256)`
    cubre la propiedad por contenido (re-subir el mismo contenido = fila ya propia, OK silencioso, aunque la
    ruta de objeto sea otra). Un choque en la OTRA UNIQUE —(storage_bucket,storage_name,storage_generation)—
    lanzaría UniqueViolation CRUDA (500); se captura dentro de un savepoint y se EXIGE que la fila de ESE
    objeto GCS ligue el mismo sha256; si liga otro contenido ⇒ ClipsOnlyOwnedInputError (nunca un 500 crudo).
    Es un caso casi imposible (el path lleva {owner}/{asset}/{sha}), pero el fail-closed queda limpio.
    NUNCA se añade un DELETE aquí: la recuperabilidad del input depende de que la fila NO se borre; el único
    cambio admitido es allowed→revoked (trigger de la 132)."""
    if not isinstance(receipt, StorageReceipt):
        raise ClipsOnlyOwnedInputError("Recibo de input no válido.")
    if origin not in _ORIGINS_SUBIDA:
        raise ClipsOnlyOwnedInputError("origin no admitido para un input subido.")
    try:
        with c.transaction():
            inserted = c.execute(
                """INSERT INTO creative_owned_inputs
                   (user_id,id,uonify_project_id,sha256,kind,mime_type,byte_size,origin,
                    storage_bucket,storage_name,storage_generation,authorization_state)
                   VALUES (%s,%s,%s,%s,'image',%s,%s,%s,%s,%s,%s,'allowed')
                   ON CONFLICT (user_id,sha256) DO NOTHING RETURNING id""",
                (owner_id, asset_id, uonify_project_id, receipt.sha256, receipt.mime_type,
                 receipt.byte_size, origin, receipt.bucket, receipt.name, receipt.generation)).fetchone()
    except psycopg.errors.UniqueViolation:
        # Choque en UNIQUE(storage_bucket,storage_name,storage_generation): el objeto ya está registrado.
        # NIT Consultor (defensa en profundidad): owner-scope UNIFORME en AMBOS lookups. Estructuralmente
        # inalcanzable cross-owner (el name lleva creative/users/{owner}/…), pero con `AND user_id=%s` el
        # caso imposible fail-closa (object_row None → raise) en vez de poder mirar una fila de otro dueño.
        object_row = c.execute(
            """SELECT id,sha256 FROM creative_owned_inputs
               WHERE storage_bucket=%s AND storage_name=%s AND storage_generation=%s
               AND user_id=%s""",
            (receipt.bucket, receipt.name, receipt.generation, owner_id)).fetchone()
        if not object_row or object_row["sha256"] != receipt.sha256:
            raise ClipsOnlyOwnedInputError(
                "El objeto subido ya está registrado con otro contenido (fail-closed).") from None
        return str(object_row["id"])
    if inserted:
        return str(inserted["id"])
    # Dedupe por CONTENIDO: la misma foto (mismo sha256) ya es propia → el ON CONFLICT NO insertó la fila
    # nueva → DEVUELVE el asset_id EXISTENTE (resoluble), no el recién minteado. (El objeto GCS del id
    # nuevo queda huérfano; su limpieza es follow-up de higiene, no bloquea.)
    existing = c.execute(
        """SELECT id FROM creative_owned_inputs WHERE user_id=%s AND sha256=%s""",
        (owner_id, receipt.sha256)).fetchone()
    if not existing:
        raise ClipsOnlyOwnedInputError("No se pudo registrar ni recuperar el input propio.")
    return str(existing["id"])


def clips_only_resolve_input_receipts(c, owner, claim, request) -> tuple:
    """`input_receipt_resolver` del live_provider: StorageReceipt de cada input del manifest, por sha256,
    SOLO del dueño y 'allowed', en ORDEN del manifest (para el zip de bind_google_owned_inputs). Texto -> ()."""
    manifest = getattr(request, "input_manifest", None)
    if not manifest:
        return ()
    owner_id = owner.get("id") if isinstance(owner, dict) else None
    if not owner_id:
        raise ClipsOnlyOwnedInputError("Identidad propietaria ausente para resolver inputs.")
    receipts = []
    for source in manifest:
        sha = source.get("sha256") if isinstance(source, dict) else None
        if not isinstance(sha, str) or not _HASH.fullmatch(sha):
            raise ClipsOnlyOwnedInputError("El input del manifest no trae un sha256 válido.")
        row = c.execute(
            """SELECT sha256,storage_bucket,storage_name,storage_generation,mime_type,byte_size,
               authorization_state FROM creative_owned_inputs WHERE user_id=%s AND sha256=%s""",
            (owner_id, sha)).fetchone()
        if not row or row["authorization_state"] != "allowed":
            raise ClipsOnlyOwnedInputError(
                "Un input no es un recurso propio verificado y vigente.")
        receipts.append(StorageReceipt(
            bucket=row["storage_bucket"], name=row["storage_name"],
            generation=row["storage_generation"], mime_type=row["mime_type"],
            byte_size=row["byte_size"], sha256=row["sha256"]))
    return tuple(receipts)
