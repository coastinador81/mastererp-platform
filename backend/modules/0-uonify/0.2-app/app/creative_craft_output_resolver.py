"""Adapter (estructura) del resolver 089 para el CraftOutputAdoptionPort (INACTIVO).

Implementa ``CraftAssetResolver`` (del port) resolviendo un ``CraftAssetRef`` ->
``CraftResolvedAsset`` contra el registry 089 (migración 089: ``creative_assets`` +
``creative_asset_revisions``).  Solo emite ``SELECT`` (+ ``FOR SHARE`` opcional):
sin INSERT/UPDATE/DELETE, sin GCS, HTTP ni dispatch.  Construirlo no tiene efecto;
``dispatch sigue cerrado``.

Resolución ORIGIN-AGNÓSTICA (decisión de Interfaz, 19-10-2026): el ``asset_id``
DETERMINISTA = ``uuid5(SEED)`` (función SEED COMPARTIDA única de SC, contrato
``platform/contracts/google-craft-registration-contract.md`` §2, semilla
``uonify:craft:v1:{owner}:{escrow}:{candidate}:{dispatch}:{ordinal}``) YA codifica la
identidad del artefacto de escrow (owner/escrow/candidate/dispatch/ordinal).  El
adapter NO reimplementa ese ``uuid5``: lo recibe por inyección (``asset_id_fn``) y
resuelve por ``(user_id, asset_id)`` -> la revisión ACTUAL y ``allowed`` ->
``(storage_bucket, storage_name, storage_generation)``.

NO verifica ``lineage.origin`` ni ``craftRef`` (eran cross-check redundante y
obligarían a alinear un valor de ``origin`` entre tres lados).  La verificación es
completa y fail-closed con: ``asset_id`` determinista + ``(sha256, byte_size,
mime_type)`` de la revisión == los del ref + prefijo
``creative/users/{owner}/assets/{assetId}/`` del ``storage_name`` +
``authorization_state=='allowed'`` + ``craft_blockers`` vacío + owner + proyecto.
Las etiquetas de escrow (``role``/``kind``/``relative_path``) se ligan en la capa del
port (compara el ``CraftResolvedAsset`` contra el artefacto); no se cruzan contra
``r.role``/``r.kind`` del 089 porque su taxonomía de ``kind`` es de medios
(``image``/``video``/``audio``), distinta de la de escrow
(``output``/``native_project``).

Cierre externo (no de ArtCraft): el hilo Google graba el ``asset_id`` determinista
con la función SEED compartida; contra una BD real el SELECT no hallará filas Craft
hasta ese registro, pero la ESTRUCTURA y sus tests (conexión + función SEED FAKE)
son válidos igualmente.
"""

from __future__ import annotations

from typing import Callable

from .creative_craft_output_port import (
    CraftAssetNotFound, CraftAssetRef, CraftAssetResolutionError,
    CraftResolvedAsset,
)


# Firma de la función SEED compartida (fuente de verdad de SC); se inyecta.
CraftAssetIdFn = Callable[[str, str, str, str, int], str]


class Registry089ResolutionError(CraftAssetResolutionError):
    """El registry 089 no resolvió exactamente una revisión Craft válida."""


class AssetRecordNotFound(CraftAssetNotFound):
    """No hay asset/revisión actual para el (user_id, asset_id) derivado del ref."""


class AssetReceiptMismatch(Registry089ResolutionError):
    """La revisión existe pero su identidad no liga el CraftAssetRef. Fail-closed."""


class AssetNotAuthorized(Registry089ResolutionError):
    """authorization_state es 'revoked' o 'quarantined'."""


class AssetNotCraftReady(Registry089ResolutionError):
    """craft_blockers no vacío: la revisión no está lista para Craft."""


class AssetProjectInactive(Registry089ResolutionError):
    """El uonify_project exigido no coincide con el de la revisión."""


class AssetOwnerMismatch(Registry089ResolutionError):
    """El owner del ref no coincide con el owner autenticado del adapter."""


_SELECT_CURRENT_REVISION = """
SELECT r.mime_type, r.byte_size, r.sha256, r.storage_bucket, r.storage_name,
       r.storage_generation, r.craft_blockers,
       a.uonify_project_id, a.authorization_state, a.state_reason
  FROM creative_assets a
  JOIN creative_asset_revisions r
    ON r.user_id = a.user_id AND r.asset_id = a.id
   AND r.revision = a.current_revision
 WHERE a.user_id = %(user_id)s AND a.id = %(asset_id)s
"""


class Registry089CraftAssetResolver:
    """``CraftAssetResolver`` contra el registry 089 (solo lectura).

    ``connection`` es una conexión/transacción psycopg abierta; ``user`` es el dict
    ``{id, google_subject}`` del owner; ``asset_id_fn`` es la función SEED COMPARTIDA
    de SC (no se reimplementa aquí).  La resolución corre dentro de la misma
    transacción que actuará sobre el registro, de modo que ``FOR SHARE`` fija la
    fila de autoridad mientras dura la adopción.
    """

    def __init__(self, connection, user: dict, asset_id_fn: "CraftAssetIdFn", *,
                 uonify_project_id: str | None = None, lock_reads: bool = True):
        if not isinstance(user, dict) or not user.get("id"):
            raise Registry089ResolutionError("Owner del resolver 089 no válido.")
        if not callable(asset_id_fn):
            raise Registry089ResolutionError(
                "La función SEED compartida no es invocable.")
        self._connection = connection
        self._user = user
        self._asset_id_fn = asset_id_fn
        self._uonify_project_id = uonify_project_id
        self._lock_reads = lock_reads

    def resolve(self, ref: CraftAssetRef) -> CraftResolvedAsset:
        if not isinstance(ref, CraftAssetRef):
            raise Registry089ResolutionError("CraftAssetRef no válido.")
        if ref.owner_user_id != self._user["id"]:
            raise AssetOwnerMismatch("El ref no pertenece al owner autenticado.")
        if type(ref.ordinal) is not int or ref.ordinal < 0:
            raise Registry089ResolutionError("ordinal no válido para el SEED.")
        asset_id = self._asset_id_fn(
            ref.owner_user_id, ref.escrow_id, ref.candidate_id,
            ref.dispatch_id, ref.ordinal)
        if not isinstance(asset_id, str) or not asset_id:
            raise Registry089ResolutionError(
                "La función SEED compartida no devolvió un asset_id.")
        row = self._select_current_revision(asset_id)
        if row is None:
            raise AssetRecordNotFound(f"({ref.owner_user_id},{asset_id})")
        self._assert_authorized(row)
        self._assert_identity(row, ref, asset_id)
        self._assert_project(row)
        return CraftResolvedAsset(
            ref.ordinal, ref.kind, ref.relative_path, ref.role,
            row["mime_type"], row["byte_size"], row["sha256"],
            row["storage_bucket"], row["storage_name"],
            row["storage_generation"])

    def _select_current_revision(self, asset_id: str):
        query = _SELECT_CURRENT_REVISION
        if self._lock_reads:
            query = query + " FOR SHARE OF a, r"
        cursor = self._connection.execute(
            query, {"user_id": self._user["id"], "asset_id": asset_id})
        return cursor.fetchone()

    @staticmethod
    def _assert_authorized(row) -> None:
        if row["authorization_state"] != "allowed":
            raise AssetNotAuthorized(
                f'{row["authorization_state"]}:{row.get("state_reason")}')
        if row["craft_blockers"]:
            raise AssetNotCraftReady("craft_blockers no vacío.")

    def _assert_identity(self, row, ref: CraftAssetRef, asset_id: str) -> None:
        if ((row["mime_type"], row["byte_size"], row["sha256"])
                != (ref.mime_type, ref.byte_size, ref.sha256)):
            raise AssetReceiptMismatch("La revisión no liga los bytes del ref.")
        prefix = f"creative/users/{ref.owner_user_id}/assets/{asset_id}/"
        name = row["storage_name"]
        if (not isinstance(name, str) or not name.startswith(prefix)
                or not isinstance(row["storage_bucket"], str)
                or not row["storage_bucket"]
                or type(row["storage_generation"]) is not int
                or row["storage_generation"] < 1):
            raise AssetReceiptMismatch("El objeto durable no liga el asset.")

    def _assert_project(self, row) -> None:
        if (self._uonify_project_id is not None
                and row["uonify_project_id"] != self._uonify_project_id):
            raise AssetProjectInactive("El proyecto del ref no coincide.")
