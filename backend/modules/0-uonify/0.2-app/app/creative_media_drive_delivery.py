"""Entrega del vídeo FINAL al Drive del cliente (Lote A, M6): sube el final como archivo creado por la
app (`drive.file`) a la carpeta «Uonify» del cliente. Vía PRINCIPAL de entrega (decisión del dueño);
Uonify NO conserva copias (el objeto GCS transitorio se borra tras esto, en Lote B).

El upload real (`google_drive_provider.upload` con el token OAuth `drive.file` del cliente) se INYECTA
(drop-in en Lote B). Aquí: validación + recibo CARD-SAFE. El `fileId` del recibo es el del PROPIO
archivo del cliente en SU Drive (su recurso; no es gs:// ni project-id, que nunca salen). La
idempotencia (reusar el id reservado en reintento; el provider es idempotente en 409) la pone el
orquestador (Lote B). Fail-closed."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


class DriveDeliveryError(Exception):
    """Fail-closed: el final no se pudo entregar al Drive del cliente de forma válida."""


@dataclass(frozen=True)
class DriveDeliveryReceipt:
    """Recibo card-safe de la entrega: el archivo del cliente en SU Drive."""
    file_id: str
    name: str
    mime_type: str


# (folder_id, file_id, name, mime, content) -> metadata dict del archivo creado (google_drive_provider.upload).
UploadFn = Callable[[str, str, str, str, bytes], dict]

_MAX_FINAL_BYTES = 1024 * 1024 * 1024  # 1 GiB: tope de sanidad del final entregado.


def deliver_final_to_drive(
        *, folder_id: str, file_id: str, name: str, mime: str, content: bytes,
        upload_fn: UploadFn) -> DriveDeliveryReceipt:
    """Sube el final a la carpeta «Uonify» del cliente vía `upload_fn` (drive.file). Fail-closed.

    `folder_id`/`file_id` los resuelve el llamador (folder + reserve_id del provider); el `file_id`
    reservado debe persistirse por intento para que el reintento reuse el mismo id (idempotencia,
    Lote B). Devuelve un recibo card-safe."""
    if not callable(upload_fn):
        raise DriveDeliveryError("upload_fn debe ser invocable.")
    for value, label in ((folder_id, "folder_id"), (file_id, "file_id"),
                         (name, "name"), (mime, "mime")):
        if not isinstance(value, str) or not value:
            raise DriveDeliveryError(f"{label} no es válido.")
    if "/" in name or "\\" in name or name in (".", ".."):
        raise DriveDeliveryError("El nombre del final no es un nombre simple.")
    if not isinstance(content, (bytes, bytearray)) or not content:
        raise DriveDeliveryError("El contenido del final está vacío.")
    if len(content) > _MAX_FINAL_BYTES:
        raise DriveDeliveryError("El final excede el tope de tamaño.")

    result = upload_fn(folder_id, file_id, name, mime, bytes(content))
    if not isinstance(result, dict):
        raise DriveDeliveryError("El upload no devolvió metadatos del archivo.")
    delivered_id = result.get("id")
    if not isinstance(delivered_id, str) or not delivered_id:
        raise DriveDeliveryError("El upload no devolvió un fileId del Drive del cliente.")
    return DriveDeliveryReceipt(file_id=delivered_id, name=name, mime_type=mime)
