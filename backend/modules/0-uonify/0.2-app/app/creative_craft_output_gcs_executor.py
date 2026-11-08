"""Executor de adopción Craft sobre GCS final-only (offline, INACTIVO).

Implementa ``CraftAdoptionExecutor.adopt(plan) -> StorageReceipt`` orquestando el
rewrite staging→durable de **una sola llamada** (final-only).  NO importa ni invoca
Google: recibe por INYECCIÓN el constructor de la petición de rewrite (``build_rewrite``)
y el transporte que la ejecuta (``run_rewrite``); el cableado real (SC) los liga en el GO
a ``creative_google_staging_adoption.google_staging_adoption_request`` +
``creative_provider_adoption_transport.adopt_google_staging_once``.  Construirlo no tiene
efecto; ``dispatch sigue cerrado``; sin llamadas reales.

Condiciones del veredicto del Consultor google (craft-gcs-executor-go-proposal.md §7):
- (1) **rewrite de una sola llamada:** el preflight exige que staging y durable compartan
  **location** y **clase** (igualdad).  La clase se **lee del bucket** vía ``placement``
  inyectado, **no se asume el literal «STANDARD»** (SC: la clase es implícita —GCS la
  aplica por ser bucket regional—, no está fijada en el bootstrap); si el durable va en el
  MISMO bucket creativo que el staging, la igualdad está garantizada por construcción.
  Una continuación (`done=false`, es decir, el transporte NO devuelve un
  ``StorageReceipt``) es **fallo controlado** — el worker libera y el escrow nunca queda
  «adopting».  location, clase y nombre de bucket son **parámetros validados**, no
  constantes (SC declara los reales en el GO).
- (2) **412 idempotente:** lo resuelve el transporte verificado
  (``adopt_google_staging_once`` → ``creative_storage_transport`` reconcilia por GET y,
  si sha256/md5/size coinciden, devuelve el ``StorageReceipt``); este executor acepta ese
  recibo venga de un rewrite fresco o de la reconciliación, y re-liga sus bytes al output.
"""

from __future__ import annotations

from typing import Callable

from .creative_craft_output_escrow import CraftOutputEscrowError
from .creative_craft_output_port import CraftArtifactAdoptionPlan, CraftResolvedAsset
from .creative_storage_contracts import StorageReceipt


# bucket -> (location, storage_class)
BucketPlacementFn = Callable[[str], "tuple[str, str]"]
# (plan, durable_bucket) -> petición de rewrite (opaca; la construye SC)
RewriteBuilderFn = Callable[[CraftArtifactAdoptionPlan, str], object]
# petición -> StorageReceipt (done) | continuación (no done) ; puede levantar
RewriteRunnerFn = Callable[[object], object]


class CraftGcsAdoptionError(CraftOutputEscrowError):
    """Base de los errores del executor GCS (fail-closed)."""


class CraftGcsPreflightError(CraftGcsAdoptionError):
    """Staging y durable no comparten location/clase, o la clase no es STANDARD."""


class CraftGcsNotFinalError(CraftGcsAdoptionError):
    """El rewrite no terminó en una sola llamada (final-only); exige otro claim."""


class CraftGcsReceiptMismatch(CraftGcsAdoptionError):
    """El StorageReceipt del rewrite no liga el output exacto del plan."""


def _valid_placement(value: object) -> bool:
    return (isinstance(value, tuple) and len(value) == 2
            and all(isinstance(item, str) and item for item in value))


class GoogleFinalOnlyCraftAdoptionExecutor:
    """``CraftAdoptionExecutor`` final-only sobre GCS; colaboradores inyectados.

    ``durable_bucket``: bucket privado destino (misma location/clase que el staging).
    ``placement(bucket) -> (location, storage_class)``: para el preflight (igualdad).
    ``build_rewrite(plan, durable_bucket) -> request``: construye el rewrite (SC).
    ``run_rewrite(request) -> StorageReceipt | continuación``: ejecuta un rewrite máximo
    y reconcilia por GET (SC, sobre adopt_google_staging_once); un resultado que no sea
    ``StorageReceipt`` es una continuación → final-only fail-closed.
    """

    def __init__(self, durable_bucket: str, placement: "BucketPlacementFn",
                 build_rewrite: "RewriteBuilderFn", run_rewrite: "RewriteRunnerFn"):
        if not isinstance(durable_bucket, str) or not durable_bucket:
            raise CraftGcsAdoptionError("Bucket durable no válido.")
        for fn in (placement, build_rewrite, run_rewrite):
            if not callable(fn):
                raise CraftGcsAdoptionError("Colaborador del executor no invocable.")
        self._durable_bucket = durable_bucket
        self._placement = placement
        self._build_rewrite = build_rewrite
        self._run_rewrite = run_rewrite

    def adopt(self, plan: CraftArtifactAdoptionPlan) -> StorageReceipt:
        if not isinstance(plan, CraftArtifactAdoptionPlan):
            raise CraftGcsAdoptionError("Plan de adopción no válido.")
        source = plan.source
        if not isinstance(source, CraftResolvedAsset):
            raise CraftGcsAdoptionError("El plan no porta un origen resuelto.")
        self._assert_same_placement(source.source_bucket)
        request = self._build_rewrite(plan, self._durable_bucket)
        result = self._run_rewrite(request)
        if not isinstance(result, StorageReceipt):
            raise CraftGcsNotFinalError(
                "El rewrite no terminó en una sola llamada; final-only exige otro claim.")
        self._assert_receipt_binds(result, plan)
        return result

    def _assert_same_placement(self, source_bucket: str) -> None:
        src = self._placement(source_bucket)
        dst = self._placement(self._durable_bucket)
        if not _valid_placement(src) or not _valid_placement(dst):
            raise CraftGcsPreflightError("Placement de bucket no válido.")
        if src != dst:
            raise CraftGcsPreflightError(
                "Staging y durable no comparten location y clase.")

    def _assert_receipt_binds(self, receipt: StorageReceipt,
                              plan: CraftArtifactAdoptionPlan) -> None:
        artifact = plan.artifact
        prefix = f"creative/users/{plan.owner_user_id}/assets/"
        if ((receipt.mime_type, receipt.byte_size, receipt.sha256)
                != (artifact.mime_type, artifact.byte_size, artifact.sha256)
                or receipt.bucket != self._durable_bucket
                or not isinstance(receipt.name, str)
                or not receipt.name.startswith(prefix)
                or type(receipt.generation) is not int or receipt.generation < 1):
            raise CraftGcsReceiptMismatch(
                "El recibo del rewrite no liga el output durable exacto.")
