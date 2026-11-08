"""Orquestador de la CADENA DE CUSTODIA del flujo de medios (Lote A): seal→stage→adopt, con borrado
de los objetos de staging en FALLO (rollback de la adopción).

Diseño contract-testable: los pasos PUROS (seal, begin/confirm adoption) se llaman directo; los pasos
con E/S (stage, cleanup) se INYECTAN, de modo que la LÓGICA de secuencia y el rollback se prueben sin
HTTP ni créditos. El cableado real (stage_craft_outputs / cleanup_google_staging_once con el token
REDUCIDO de `creative_media_worker_credential` + session; observe en `creative_media_observe`) se
enchufa en Lote B y lo verifica el Consultor.

FUERA de esta función (Lote B, tras M6 — entrega a Drive): el borrado de los transitorios en ÉXITO
(post-entrega: request_craft_output_cleanup → cleanup_google_staging_once → mark_craft_output_deleted)
y el borrado de las copias de trabajo LOCALES del montaje (éxito y fallo). Esta función devuelve el
escrow ADOPTADO + los StorageReceipts para que Lote B secuencie la entrega y la purga."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .creative_craft_output_escrow import (
    CraftEscrowArtifact, CraftEscrowFence, CraftExpectedEscrowArtifact,
    CraftOutputEscrow, begin_craft_output_adoption, confirm_craft_output_adoption,
    seal_craft_output_escrow,
)
from .creative_storage_contracts import StorageReceipt


class MediaCustodyError(Exception):
    """Fail-closed: la cadena de custodia no pudo completar la adopción durable."""


@dataclass(frozen=True)
class CustodySealContext:
    """Parámetros autoritativos del sellado (del intento de montaje; los fija el servidor)."""
    escrow_id: str
    fence: CraftEscrowFence
    dispatch_id: str
    request_sha256: str
    authority_sha256: str
    engine_name: str
    engine_version: str
    operation: str
    expected: tuple[CraftExpectedEscrowArtifact, ...]
    candidate_result_sha256: str


@dataclass(frozen=True)
class CustodyResult:
    escrow: CraftOutputEscrow            # estado "adopted"
    staged: tuple[StorageReceipt, ...]   # objetos durables ligados (para entrega + purga en Lote B)


# manifest sellado -> StorageReceipts en orden de artefacto (el stage real sube y devuelve estos).
StageFn = Callable[[object], "tuple[StorageReceipt, ...]"]
# borra los objetos de staging ya subidos (rollback en fallo; o purga tras entrega en Lote B).
CleanupFn = Callable[["tuple[StorageReceipt, ...]"], None]


def run_custody_chain(
        context: CustodySealContext,
        observed: tuple[CraftEscrowArtifact, ...],
        *, stage: StageFn, cleanup_staged: CleanupFn,
        prior: CraftOutputEscrow | None = None) -> CustodyResult:
    """Sella con `observed`, sube (stage) los bytes a objetos durables y los ADOPTA (§H.3). En FALLO
    tras el stage, borra los objetos subidos (rollback) y re-lanza el error original. Fail-closed.

    `stage`/`cleanup_staged` son inyectables; en Lote B envuelven los primitivos reales con el token
    reducido + session. `prior` permite el resume idempotente (seal create-only devuelve el prior)."""
    if not callable(stage) or not callable(cleanup_staged):
        raise MediaCustodyError("stage/cleanup_staged deben ser invocables.")
    if not isinstance(context, CustodySealContext):
        raise MediaCustodyError("Falta el contexto de sellado.")

    receipt = seal_craft_output_escrow(
        escrow_id=context.escrow_id, fence=context.fence,
        dispatch_id=context.dispatch_id, request_sha256=context.request_sha256,
        authority_sha256=context.authority_sha256, engine_name=context.engine_name,
        engine_version=context.engine_version, operation=context.operation,
        expected=context.expected, observed=observed,
        candidate_result_sha256=context.candidate_result_sha256, prior=prior)
    escrow = receipt.escrow

    staged = stage(escrow.manifest)
    if (not isinstance(staged, tuple) or not staged
            or any(not isinstance(item, StorageReceipt) for item in staged)):
        # Sin StorageReceipts fiables no hay nada que adoptar ni que borrar con certeza.
        raise MediaCustodyError("El stage no devolvió StorageReceipts.")

    try:
        escrow = begin_craft_output_adoption(escrow)
        escrow = confirm_craft_output_adoption(escrow, staged)
    except Exception:
        cleanup_staged(staged)  # borrado de transitorios en FALLO (rollback)
        raise
    return CustodyResult(escrow=escrow, staged=staged)
