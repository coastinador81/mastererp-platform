"""Entrega del clip clips-only al Drive del cliente — rama (c), preview NATIVO (STAGED + INERTE).

El dueño eligió (c) el 27-10: el clip adoptado se COPIA al Drive del cliente (`drive.file` app-owned) y el
preview es NATIVO en su Drive. El puntero que sale al frontend es el `fileId` del PROPIO archivo del cliente
en SU Drive (card-safe: nunca gs://, bucket, generación ni project-id — D-PROTECCIÓN). COMPONE primitivos ya
revisados; NO hace HTTP ni SQL raw propio:

  download_verified(StorageReceipt adoptado, token cloud-platform)  → bytes (verifica byte_size + sha256 ==
      el recibo ADOPTADO, y fija la generación; lectura GCS del output de Veo, requiere uniform
      bucket-level access en el bucket §6)
  → google_drive_provider.folder(drive_token)                       → carpeta «Uonify» del cliente (idempotente)
  → creative_media_drive_delivery.deliver_final_to_drive(..., upload_fn = provider.upload drive.file)
  → recibo card-safe (fileId del cliente en SU Drive).

DOS tokens PATH A del MISMO cliente, scopes DISTINTOS: `cloud_token` (cloud-platform, lee el output de Veo en
GCS) + `drive_token` (drive.file ESCRITURA, sube a su Drive). El dueño amplió el scope a `drive.file` escritura
el 27-10 (conversaciones→Drive); para los clips del Estudio es ADITIVO, no un scope nuevo. Ambos tokens los
aporta el cableado (connection_loader de la voz, PATH A); si la conexión del piloto sigue solo en
`drive.readonly`, la subida devuelve 403 (prerequisito de scope, marcado a interfaz).

IDEMPOTENCIA (condición del primitivo `deliver_final_to_drive`): el `reserved_file_id` lo RESERVA y PERSISTE el
CALLER ANTES de llamar aquí (puerto de reserva + migración = cableado, aparte), de modo que un reintento REUSE
el mismo id y `google_drive_provider.upload` devuelva el MISMO archivo en 409 (no duplica en el Drive del
cliente). Esta función NO abre transacciones ni red de reserva: recibe el id ya reservado y entrega.

Fail-closed: cualquier incoherencia ⇒ ClipsOnlyDriveDeliveryError. STAGED + INERTE: sin red/SQL propios (los
hacen los primitivos inyectados); sin trigger registrado. El TRIGGER (entrega ansiosa por worker vs perezosa
al abrir el preview = decisión UX del DUEÑO, D-UX-OWNER-DEFINES), la persistencia (migración + recorder del id
reservado/entregado, orden de lock como en upload_route) y el cableado (tokens, provider, session) VUELVEN al
Consultor + REA. Read-only sobre GCS; ESCRIBE en el Drive del cliente (pieza sensible).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from .creative_media_drive_delivery import (DriveDeliveryError,
                                            deliver_final_to_drive)
from .creative_storage_contracts import StorageReceipt
from .creative_storage_transport import (StorageTransportError,
                                         download_verified)

_VIDEO_MIME = 'video/mp4'
# Tope de sanidad del clip entregado; un clip clips-only (≤8 s/720p) es MUY inferior. Alinea con el techo
# de import_generated_video_once (250 MB) y queda por debajo del tope de deliver_final_to_drive (1 GiB).
_MAX_CLIP_BYTES = 256 * 1024 * 1024


class ClipsOnlyDriveDeliveryError(Exception):
    """Fail-closed: el clip no se pudo entregar al Drive del cliente de forma válida."""


@dataclass(frozen=True)
class ClipDriveDeliveryReceipt:
    """Recibo card-safe de la entrega del clip: el archivo del cliente en SU Drive (no gs://, no project)."""
    file_id: str
    name: str
    mime_type: str
    sha256: str


@runtime_checkable
class ClipDriveProvider(Protocol):
    """Subconjunto `drive.file` de google_drive_provider que usa la entrega (primitivo ya revisado).

    `upload` es 409-idempotente sobre el MISMO id reservado (reintento → mismo archivo); `folder` localiza o
    crea la carpeta «Uonify» por appProperties (idempotente)."""

    def folder(self, token: str) -> str:
        ...

    def upload(self, token: str, folder: str, identifier: str, name: str,
               mime: str, content: bytes) -> dict:
        ...


def _safe_name(name: object) -> str:
    """Nombre simple y card-safe para el archivo del cliente (el nombre visible es decisión UX del dueño/
    Frontend-app; aquí solo se valida que sea un nombre de archivo simple)."""
    if (not isinstance(name, str) or not name or '/' in name or '\\' in name
            or name in ('.', '..') or len(name) > 120 or '\x00' in name):
        raise ClipsOnlyDriveDeliveryError('El nombre del clip no es un nombre de archivo simple válido.')
    return name


def deliver_clip_to_drive(
        *, receipt: StorageReceipt, name: str, reserved_file_id: str,
        cloud_token: str, drive_token: str, provider: ClipDriveProvider,
        session) -> ClipDriveDeliveryReceipt:
    """Entrega el clip ADOPTADO al Drive del cliente reusando el id reservado. Fail-closed; 0 duplicados.

    `receipt` = StorageReceipt del clip ADOPTADO (bucket/name/generation/mime/byte_size/sha256; lo resuelve el
    caller del 089/journal del paso storage_adopt SUCCEEDED). `reserved_file_id` ya está reservado+persistido
    por el caller (idempotencia). `cloud_token` lee GCS (uniform access); `drive_token` sube (drive.file).
    Devuelve el recibo card-safe (fileId del cliente). No abre transacciones; no reserva; no re-POSTea."""
    if not isinstance(receipt, StorageReceipt):
        raise ClipsOnlyDriveDeliveryError('El recibo del clip adoptado no es canónico.')
    if receipt.mime_type != _VIDEO_MIME:
        raise ClipsOnlyDriveDeliveryError('El clip adoptado no es video/mp4.')
    if (not isinstance(receipt.byte_size, int) or isinstance(receipt.byte_size, bool)
            or not 0 < receipt.byte_size <= _MAX_CLIP_BYTES):
        raise ClipsOnlyDriveDeliveryError('El tamaño del clip adoptado no es admisible.')
    safe = _safe_name(name)
    if not isinstance(reserved_file_id, str) or not reserved_file_id:
        raise ClipsOnlyDriveDeliveryError('Falta el fileId reservado para la entrega.')
    for token, label in ((cloud_token, 'cloud_token'), (drive_token, 'drive_token')):
        if not isinstance(token, str) or not token:
            raise ClipsOnlyDriveDeliveryError(f'{label} PATH A ausente.')
    if (not callable(getattr(provider, 'folder', None))
            or not callable(getattr(provider, 'upload', None))):
        raise ClipsOnlyDriveDeliveryError('El provider de Drive no es válido.')

    # (1) Lee el clip adoptado de GCS con el token cloud-platform del cliente; download_verified fija la
    # generación y verifica byte_size + sha256 == el recibo adoptado ⇒ se entrega EXACTAMENTE lo adoptado.
    try:
        content = download_verified(receipt, cloud_token, session)
    except StorageTransportError as error:
        raise ClipsOnlyDriveDeliveryError('No se pudo leer el clip adoptado de GCS.') from error
    if not isinstance(content, (bytes, bytearray)) or len(content) != receipt.byte_size:
        raise ClipsOnlyDriveDeliveryError('El clip leído no coincide con el tamaño del recibo adoptado.')

    # (2) Carpeta «Uonify» del cliente (idempotente) + entrega drive.file reusando el id reservado (el
    # provider es 409-idempotente sobre ese id ⇒ el reintento no duplica).
    folder_id = provider.folder(drive_token)
    if not isinstance(folder_id, str) or not folder_id:
        raise ClipsOnlyDriveDeliveryError('No se resolvió la carpeta «Uonify» del cliente.')

    def _upload(folder: str, fid: str, fname: str, mime: str, data: bytes) -> dict:
        return provider.upload(drive_token, folder, fid, fname, mime, data)

    try:
        drive_receipt = deliver_final_to_drive(
            folder_id=folder_id, file_id=reserved_file_id, name=safe,
            mime=_VIDEO_MIME, content=bytes(content), upload_fn=_upload)
    except DriveDeliveryError as error:
        raise ClipsOnlyDriveDeliveryError('La entrega al Drive del cliente falló.') from error

    return ClipDriveDeliveryReceipt(
        file_id=drive_receipt.file_id, name=drive_receipt.name,
        mime_type=drive_receipt.mime_type, sha256=receipt.sha256)
