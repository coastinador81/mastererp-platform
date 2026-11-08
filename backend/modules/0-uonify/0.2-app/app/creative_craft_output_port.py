"""Port de adopción de salida Craft sobre un resolver 089 inyectado (INACTIVO).

Inversión de dependencias: el port define la interfaz que NECESITA —un resolver
que mapea una referencia de artefacto a su asset de origen exacto
(``resolve(ref) -> CraftResolvedAsset``, con ``not_found`` / ``ambiguous``)— e
implementa ``CraftOutputAdoptionPort`` (tipado estructural) orquestando tres
colaboradores inyectados: el resolver, un ejecutor de copia final-only
create-only que devuelve un ``StorageReceipt`` durable, y un sumidero que
persiste cada recibo donde la autoridad 114 lo re-verificará.

El port no abre dispatch ni toca PostgreSQL, GCS o HTTP: todo efecto vive en los
colaboradores inyectados.  Cuando llegue el contrato real del resolver del
registry 089 solo se reconcilian ``CraftResolvedAsset`` / ``resolve`` y se liga
un adapter real; la lógica de ligado exacto de este port no cambia.

El ligado que impone aquí es el mismo que ``confirm_craft_output_adoption``
re-verifica desde la BD: identidad ``(mimeType, byteSize, sha256)`` por ordinal,
generación durable ``>= 1`` y unicidad del objeto privado ``(bucket, name,
generation)``.  Cualquier desajuste, resolución no única o copia no durable
falla cerrado con ``CraftOutputEscrowError``, de modo que el worker libera el
lease y la recuperación continúa desde la fila durable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from .creative_craft_output_escrow import (
    CraftEscrowArtifact, CraftEscrowManifest, CraftOutputEscrowError,
)
from .creative_storage_contracts import StorageReceipt

if TYPE_CHECKING:  # pragma: no cover - solo para anotaciones, sin importar la BD
    from .creative_craft_output_adoption_worker import CraftOutputAdoptionLease


_ADOPTING = "adopting"


class CraftAssetResolutionError(CraftOutputEscrowError):
    """El resolver del registry 089 no devolvió exactamente un asset de origen."""


class CraftAssetNotFound(CraftAssetResolutionError):
    """Ningún asset de origen liga la referencia exacta del artefacto."""


class CraftAssetAmbiguous(CraftAssetResolutionError):
    """Más de un asset de origen liga la referencia; el origen no es único."""


@dataclass(frozen=True)
class CraftAssetRef:
    """Clave de búsqueda inmutable que el resolver 089 resuelve a un origen."""

    owner_user_id: str
    escrow_id: str
    candidate_id: str
    dispatch_id: str
    ordinal: int
    kind: str
    relative_path: str
    role: str
    mime_type: str
    byte_size: int
    sha256: str


@dataclass(frozen=True)
class CraftResolvedAsset:
    """Asset de origen resuelto: identidad del artefacto + objeto GCS fijado.

    ``source_generation`` fija la generación de origen para que la copia sea
    determinista y final-only.  Los campos de identidad deben coincidir con el
    artefacto del manifest; los de origen son columnas reales del registry 089.
    """

    ordinal: int
    kind: str
    relative_path: str
    role: str
    mime_type: str
    byte_size: int
    sha256: str
    source_bucket: str
    source_name: str
    source_generation: int


@dataclass(frozen=True)
class CraftArtifactAdoptionPlan:
    """Lo que el ejecutor necesita para una copia durable de un artefacto."""

    owner_user_id: str
    escrow_id: str
    candidate_id: str
    manifest_sha256: str
    artifact: CraftEscrowArtifact
    source: CraftResolvedAsset
    # dispatch_id del manifest: input OBLIGATORIO del SEED v1 (craft_output_asset_id)
    # con el que build_rewrite construye el dest_name durable. Default "" en
    # construcciones que no adoptan; el port siempre pasa manifest.dispatch_id.
    dispatch_id: str = ""


class CraftAssetResolver(Protocol):
    def resolve(self, ref: CraftAssetRef) -> CraftResolvedAsset:
        """Devuelve el único asset de origen de ``ref`` o levanta not_found/ambiguous."""


class CraftAdoptionExecutor(Protocol):
    def adopt(self, plan: CraftArtifactAdoptionPlan) -> StorageReceipt:
        """Una copia final-only create-only; un ``StorageReceipt`` significa durable."""


class CraftDurableReceiptSink(Protocol):
    def record(self, lease: "CraftOutputAdoptionLease", ordinal: int,
               receipt: StorageReceipt) -> None:
        """Persiste un recibo durable donde la evidencia 114 lo leerá."""


class ResolvingCraftOutputAdoptionPort:
    """``CraftOutputAdoptionPort`` implementado sobre colaboradores 089 inyectados.

    Construirlo no tiene efecto externo; ``adopt`` no abre dispatch.
    """

    def __init__(self, resolver: CraftAssetResolver,
                 executor: CraftAdoptionExecutor,
                 sink: CraftDurableReceiptSink):
        self._resolver = resolver
        self._executor = executor
        self._sink = sink

    def adopt(self, lease: "CraftOutputAdoptionLease") -> dict:
        manifest = lease.manifest
        if not isinstance(manifest, CraftEscrowManifest):
            raise CraftOutputEscrowError("El lease no porta un manifest cerrado.")
        if lease.phase != _ADOPTING:
            raise CraftOutputEscrowError(
                "El port de adopción solo opera en fase adopting.")
        candidate_id = lease.candidate_id
        identities: set[tuple[str, str, int]] = set()
        for ordinal, artifact in enumerate(manifest.artifacts):
            if artifact.ordinal != ordinal:
                raise CraftOutputEscrowError(
                    "El manifest no es contiguo por ordinal.")
            source = self._resolve(manifest, candidate_id, artifact)
            plan = CraftArtifactAdoptionPlan(
                manifest.fence.owner_user_id, manifest.escrow_id, candidate_id,
                manifest.manifest_sha256, artifact, source, manifest.dispatch_id)
            receipt = self._adopt_one(plan)
            identity = (receipt.bucket, receipt.name, receipt.generation)
            if identity in identities:
                raise CraftOutputEscrowError(
                    "La adopción repite un objeto privado.")
            identities.add(identity)
            self._sink.record(lease, artifact.ordinal, receipt)
        if len(identities) != len(manifest.artifacts):
            raise CraftOutputEscrowError("La adopción no cubre cada ordinal.")
        return {
            "schemaVersion": 1,
            "escrowId": manifest.escrow_id,
            "manifestSha256": manifest.manifest_sha256,
            "candidateId": candidate_id,
            "status": "durable",
        }

    def _resolve(self, manifest: CraftEscrowManifest, candidate_id: str,
                 artifact: CraftEscrowArtifact) -> CraftResolvedAsset:
        ref = CraftAssetRef(
            manifest.fence.owner_user_id, manifest.escrow_id, candidate_id,
            manifest.dispatch_id, artifact.ordinal, artifact.kind,
            artifact.relative_path, artifact.role, artifact.mime_type,
            artifact.byte_size, artifact.sha256)
        source = self._resolver.resolve(ref)
        if not isinstance(source, CraftResolvedAsset):
            raise CraftOutputEscrowError(
                "El resolver 089 no devolvió un asset cerrado.")
        if (source.ordinal != artifact.ordinal
                or source.kind != artifact.kind
                or source.relative_path != artifact.relative_path
                or source.role != artifact.role
                or (source.mime_type, source.byte_size, source.sha256)
                != (artifact.mime_type, artifact.byte_size, artifact.sha256)):
            raise CraftOutputEscrowError(
                "El asset 089 no liga el output exacto del manifest.")
        if (not isinstance(source.source_bucket, str) or not source.source_bucket
                or not isinstance(source.source_name, str)
                or not source.source_name
                or type(source.source_generation) is not int
                or source.source_generation < 1):
            raise CraftOutputEscrowError(
                "El origen 089 no está fijado por generación.")
        return source

    def _adopt_one(self, plan: CraftArtifactAdoptionPlan) -> StorageReceipt:
        receipt = self._executor.adopt(plan)
        if not isinstance(receipt, StorageReceipt):
            raise CraftOutputEscrowError(
                "La adopción no completó durable; final-only exige otro claim.")
        artifact = plan.artifact
        if ((receipt.mime_type, receipt.byte_size, receipt.sha256)
                != (artifact.mime_type, artifact.byte_size, artifact.sha256)
                or not isinstance(receipt.bucket, str) or not receipt.bucket
                or not isinstance(receipt.name, str) or not receipt.name
                or type(receipt.generation) is not int
                or receipt.generation < 1):
            raise CraftOutputEscrowError(
                "El StorageReceipt durable no liga el output exacto.")
        return receipt
