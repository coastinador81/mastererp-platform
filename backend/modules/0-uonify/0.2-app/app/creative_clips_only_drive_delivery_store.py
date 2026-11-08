"""Persistencia de la ENTREGA del clip al Drive (rama (c)) sobre `creative_clip_drive_deliveries` (migración
136). SQL puro single-op sobre la conexión `c` inyectada — SIN red y SIN multi-fase aquí.

El FASEADO lo pone el TRIGGER/caller (cableado de interfaz), con la lección de upload_route: NUNCA mantener un
lock de escritura mientras se hace la reserva de red del fileId ni mientras se suben los bytes. Faseado esperado:
  A (txn corta): `clips_only_get_delivery` → si delivered, corto-circuito idempotente (devolver el fileId).
  B (SIN lock): si no hay fila, `provider.reserve_id(drive_token)` (red) para obtener el fileId.
  C (txn corta): `clips_only_reserve_delivery` (INSERT create-only; ON CONFLICT no pisa → devuelve el id que ganó).
  D (SIN lock): `deliver_clip_to_drive(reserved_file_id=...)` (lee GCS + sube a Drive).
  E (txn corta): `clips_only_record_delivery` (reserved -> delivered, write-once por el trigger de la 136).

Idempotencia: el fileId se persiste create-only ANTES de subir; un reintento reusa el id que ganó y
google_drive_provider.upload es 409-idempotente ⇒ 0 duplicados en el Drive del cliente. STAGED + INERTE: no lo
llama nada vivo (lo cablea interfaz). VUELVE al Consultor + REA. D-PROTECCIÓN: no expone gs:// ni project-id.
"""
from __future__ import annotations

from dataclasses import dataclass

from .creative_storage_contracts import StorageReceipt


class ClipsOnlyDriveDeliveryStoreError(Exception):
    """Fail-closed: no se pudo registrar/recuperar la entrega al Drive del cliente."""


@dataclass(frozen=True)
class AdoptedClip:
    """El clip adoptado del job resuelto del 089: su StorageReceipt + el asset_id (para reservar/auditar)."""
    receipt: StorageReceipt
    asset_id: str


def clips_only_resolve_adopted_clip(c, *, user_id: str, job_id: str) -> AdoptedClip:
    """Resuelve el clip ADOPTADO del job DESDE el 089 AUTORITATIVO (condición del Consultor §8.11.1): la
    revisión de VÍDEO del job con el asset padre 'allowed' y en su revisión VIGENTE. Devuelve el StorageReceipt
    (entrada `receipt` de deliver_clip_to_drive) + el asset_id (para clips_only_reserve_delivery). El sha256 del
    recibo es el que la adopción RE-HASHEÓ independiente en el import, así download_verified(byte_size+sha256==
    este) es la garantía de integridad end-to-end (NO hace falta re-asertar contra el 089 por separado).
    EXACTAMENTE una fila (clips-only = 1 clip/job); 0 o >1 ⇒ fail-closed (nunca entregar un clip al azar).
    FOR SHARE: no se entrega un asset en revocación concurrente."""
    rows = c.execute(
        """SELECT r.asset_id, r.storage_bucket, r.storage_name, r.storage_generation,
                  r.mime_type, r.byte_size, r.sha256
           FROM creative_asset_revisions r
           JOIN creative_assets a ON a.user_id = r.user_id AND a.id = r.asset_id
           WHERE r.user_id=%s AND r.source_job_id=%s AND r.kind='video'
             AND a.authorization_state='allowed' AND a.current_revision = r.revision
           FOR SHARE""",
        (user_id, job_id)).fetchall()
    if len(rows) != 1:
        raise ClipsOnlyDriveDeliveryStoreError(
            "El clip adoptado del job no es único y vigente en el 089 (fail-closed).")
    row = rows[0]
    return AdoptedClip(
        receipt=StorageReceipt(
            row["storage_bucket"], row["storage_name"], row["storage_generation"],
            row["mime_type"], row["byte_size"], row["sha256"]),
        asset_id=str(row["asset_id"]))


@dataclass(frozen=True)
class ClipDeliveryState:
    """Estado durable de la entrega para (user_id, job_id). delivered_* None ⇒ reservado, aún no entregado."""
    reserved_file_id: str
    delivered_file_id: str | None
    sha256: str | None


def clips_only_get_delivery(c, *, user_id: str, job_id: str) -> ClipDeliveryState | None:
    """Estado vigente de la entrega del clip del job, o None si aún no se reservó. FOR SHARE (coherente con
    el resto del mundo 090)."""
    row = c.execute(
        """SELECT reserved_file_id, delivered_file_id, sha256
           FROM creative_clip_drive_deliveries WHERE user_id=%s AND job_id=%s FOR SHARE""",
        (user_id, job_id)).fetchone()
    if not row:
        return None
    return ClipDeliveryState(
        reserved_file_id=row["reserved_file_id"],
        delivered_file_id=row["delivered_file_id"], sha256=row["sha256"])


def clips_only_reserve_delivery(c, *, user_id: str, job_id: str, asset_id: str,
                                reserved_file_id: str) -> ClipDeliveryState:
    """INSERT create-only de la reserva (el `reserved_file_id` lo reservó el caller FUERA de lock, fase B).
    ON CONFLICT (user_id, job_id) no pisa: si otra reserva ya ganó, el id sobrante queda SIN usar (inocuo) y se
    devuelve el estado EFECTIVO (el id que ganó). Fail-closed si no queda fila."""
    if not reserved_file_id:
        raise ClipsOnlyDriveDeliveryStoreError("Falta el fileId reservado para la entrega.")
    c.execute(
        """INSERT INTO creative_clip_drive_deliveries (user_id, job_id, asset_id, reserved_file_id, status)
           VALUES (%s, %s, %s, %s, 'reserved') ON CONFLICT (user_id, job_id) DO NOTHING""",
        (user_id, job_id, asset_id, reserved_file_id))
    state = clips_only_get_delivery(c, user_id=user_id, job_id=job_id)
    if state is None:
        raise ClipsOnlyDriveDeliveryStoreError("La reserva de entrega no quedó registrada.")
    return state


def clips_only_record_delivery(c, *, user_id: str, job_id: str, file_id: str, sha256: str) -> None:
    """Marca reserved -> delivered (write-once vía el trigger de la 136). El guard `delivered_file_id IS NULL`
    lo hace idempotente: si ya estaba entregado, es no-op (no reescribe) ⇒ no dispara el write-once. Un intento
    de entregar un fileId/sha distinto sobre una fila ya delivered lo rechaza el trigger (fail-closed)."""
    if not file_id or not sha256:
        raise ClipsOnlyDriveDeliveryStoreError("fileId/sha256 de entrega ausentes.")
    c.execute(
        """UPDATE creative_clip_drive_deliveries
           SET delivered_file_id=%s, sha256=%s, status='delivered', delivered_at=now()
           WHERE user_id=%s AND job_id=%s AND delivered_file_id IS NULL""",
        (file_id, sha256, user_id, job_id))
