"""Uploader V1 de salidas Craft: render local -> staging GCS con cadena de custodia.

Gemelo Craft de ``creative_google_output_staging``/``creative_google_staging_v2`` para la
MITAD de ESCRITURA a staging (la adopción staging->durable ya existe en
``creative_craft_output_gcs_cabling``). Por cada ``CraftEscrowArtifact`` sellado de kind
``output``: lee los bytes locales, re-verifica que su sha256 coincide con el sellado del
escrow (fail-closed = nacimiento del sha256 sobre los bytes), construye la carga create-only
con ``storage_upload`` (valida el medio y calcula md5), la renombra al nombre canónico de
staging Craft y la sube con ``upload_once``/``upload_resumable_once``. Verifica el recibo
(ruta/tamaño/sha256) fail-closed y devuelve un ``CraftOutputStagingReceipt`` EN PROCESO
(sin tabla; lo durable es el registry 089 + outbox 111, como la adopción).

Veredicto del Consultor (2026-10-22, ``revisiones/20261022-VEREDICTO-UPLOADER-V1-Q2-Q3.md``):
- Q2: nombre ``creative/staging/google/{owner}/{attempt}/craft/{escrowId}/{ordinal}-{sha256}.{ext}``.
  Segmento ``craft/`` SOLO-Craft, disjunto de ``provider/`` (Veo, §6) y ``outputs/``; nunca se
  escribe bajo ``provider/``. Independiente de la migración 129.
- Q3: recibo en proceso, sin migración; durable por 089 + 111.
- Q1: md5 sobre bytes locales + re-verificar sha256==escrow, sin re-hash adicional.

INERTE: importarlo/construir el recibo no toca GCS ni red. ``stage_craft_outputs`` solo actúa
con un ``token``/``session`` reales, lo que ocurre tras el GO (verificación del Consultor +
autorización del dueño). Entrega solo en el release creativo completo, nunca superposición.
"""

from dataclasses import asdict, dataclass
from pathlib import Path, PurePosixPath
from uuid import NAMESPACE_URL, uuid5

from .creative_composite_quote import canonical_sha256
from .creative_craft_output_escrow import CraftEscrowManifest
# Reusa el helper GENÉRICO _rename_upload de staging_v2 (renombra el StorageObject y
# reconstruye la metadata md5Hash/sha256 + el multipart); NO tiene semántica Veo. No duplicar
# esta lógica md5/multipart ni especializarla a Veo. Seguimiento aprobado por el Consultor:
# al consolidar el release se promoverá a un `rename_upload` público en un módulo neutro.
from .creative_google_staging_v2 import _rename_upload
from .creative_storage_contracts import (
    ResumableStorageRequest, StorageReceipt, StorageRequest, storage_upload)
from .creative_storage_transport import upload_once, upload_resumable_once


_OUTPUT_KIND = "output"


class CraftOutputStagingError(ValueError):
    """Una salida Craft no pudo sellarse en staging de forma exacta."""


@dataclass(frozen=True)
class CraftOutputStagingReceipt:
    """Artefacto EN PROCESO (sin tabla): instantánea + sha256 canónico. Gemelo de
    ``GoogleOutputStagingReceipt``. Alimenta el registry 089 en la adopción."""
    snapshot: dict
    sha256: str


def craft_output_staging_name(owner_user_id: str, attempt_id: str, escrow_id: str,
                              ordinal: int, sha256: str, extension: str) -> str:
    """Nombre canónico de staging Craft (Q2). Determinista por artefacto."""
    return (f"creative/staging/google/{owner_user_id}/{attempt_id}/craft/"
            f"{escrow_id}/{ordinal:04d}-{sha256}.{extension}")


def _read_output_bytes(output_root: Path, relative_path: str) -> bytes:
    """Lee los bytes locales de una salida, confinada bajo ``out/`` (defensa en profundidad;
    el escrow ya validó la ruta)."""
    path = PurePosixPath(relative_path)
    if (path.is_absolute() or "\\" in relative_path
            or any(part in ("", ".", "..") for part in path.parts)
            or path.as_posix() != relative_path or path.parts[0] != "out"):
        raise CraftOutputStagingError("La ruta de salida Craft no es relativa segura.")
    resolved = (output_root / path).resolve()
    if output_root.resolve() not in resolved.parents:
        raise CraftOutputStagingError("La salida Craft sale de output_root.")
    try:
        return resolved.read_bytes()
    except OSError as error:
        raise CraftOutputStagingError("No se pudo leer la salida Craft local.") from error


def _upload(upload, token: str, session, *, expected_location: str) -> StorageReceipt:
    if isinstance(upload, ResumableStorageRequest):
        return upload_resumable_once(
            upload, token, session, expected_location=expected_location)
    if isinstance(upload, StorageRequest):
        return upload_once(upload, token, session, expected_location=expected_location)
    raise CraftOutputStagingError("Carga de staging Craft no válida.")


def stage_craft_outputs(manifest: CraftEscrowManifest, output_root: Path, bucket: str,
                        token: str, session, *,
                        expected_location: str) -> CraftOutputStagingReceipt:
    """Sube a staging cada salida sellada y devuelve el recibo en proceso (fail-closed).

    ``manifest`` es ``escrow.manifest`` de un ``CraftOutputEscrow`` ya sellado; ``output_root``
    es la raíz local del render; ``bucket`` (staging) y ``expected_location`` los fija el
    servidor. ``session``+``token`` son la autorización Cloud; sin ellos no hay efecto."""
    if not isinstance(manifest, CraftEscrowManifest):
        raise CraftOutputStagingError("Manifest de escrow Craft no válido.")
    if not isinstance(output_root, Path):
        raise CraftOutputStagingError("output_root debe ser una ruta local.")
    owner = manifest.fence.owner_user_id
    attempt_id = manifest.fence.attempt_id
    outputs = tuple(a for a in manifest.artifacts if a.kind == _OUTPUT_KIND)
    if not outputs:
        raise CraftOutputStagingError("El manifest no tiene salidas que subir.")
    objects = []
    for artifact in outputs:
        data = _read_output_bytes(output_root, artifact.relative_path)
        # UUID determinista para storage_upload; el nombre se renombra a staging después.
        asset_id = str(uuid5(
            NAMESPACE_URL, f"uonify:craft-staging:{manifest.escrow_id}:{artifact.ordinal}"))
        upload = storage_upload(bucket, owner, asset_id, artifact.mime_type, data)
        # Nacimiento de la custodia: el sha256 de los bytes DEBE casar con el sellado.
        if upload.expected.sha256 != artifact.sha256:
            raise CraftOutputStagingError(
                "El sha256 de la salida no coincide con el sellado del escrow.")
        extension = upload.expected.name.rsplit(".", 1)[-1]
        name = craft_output_staging_name(
            owner, attempt_id, manifest.escrow_id, artifact.ordinal,
            artifact.sha256, extension)
        renamed = _rename_upload(upload, name)
        expected = renamed.expected
        receipt = _upload(renamed, token, session, expected_location=expected_location)
        if (not isinstance(receipt, StorageReceipt)
                or (receipt.bucket, receipt.name, receipt.mime_type,
                    receipt.byte_size, receipt.sha256)
                != (expected.bucket, expected.name, expected.mime_type,
                    expected.byte_size, expected.sha256)):
            raise CraftOutputStagingError(
                "El recibo GCS no coincide con la salida Craft esperada.")
        objects.append({
            "ordinal": artifact.ordinal, "role": artifact.role,
            "storageReceipt": asdict(receipt),
            "md5_base64": expected.md5_base64,
            "lineage": {
                "origin": "craft", "escrowId": manifest.escrow_id,
                "attemptId": attempt_id, "dispatchId": manifest.dispatch_id,
                "engine": manifest.engine_name, "operation": manifest.operation,
                "sha256": artifact.sha256},
        })
    snapshot = {
        "schemaVersion": 1,
        "escrowId": manifest.escrow_id,
        "attemptId": attempt_id,
        "dispatchId": manifest.dispatch_id,
        "engine": {"name": manifest.engine_name,
                   "version": manifest.engine_version,
                   "operation": manifest.operation},
        "objects": objects,
        "publicationAuthorized": False,
    }
    return CraftOutputStagingReceipt(snapshot, canonical_sha256(snapshot))
