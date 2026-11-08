"""Composición PRE-GO (inerte) del port de adopción de salidas Craft.

Fábrica que ensambla el ``ResolvingCraftOutputAdoptionPort`` con el **resolver 089
REAL** (``Registry089CraftAssetResolver`` + la función SEED COMPARTIDA de SC,
``craft_output_asset_id``) y, por defecto, un ``CraftAdoptionExecutor`` y un
``CraftDurableReceiptSink`` **STUB que fallan CERRADO** si se invocan.

Objetivo: dejar la composición cableada y probada de modo que el GO sea solo
**enchufar los colaboradores reales** (executor sobre el transporte final-only de SC;
sink sobre la autoridad 114 de Interfaz), pasándolos a la fábrica.

Esto es INERTE: construir la fábrica NO tiene efecto (el resolver solo hace ``SELECT``
al llamar ``resolve()``; los stubs fallan cerrado). **NO abre dispatch, NO toca el
worker vivo, NO arranca nada.** ``dispatch`` sigue CERRADO.
"""

from __future__ import annotations

from .creative_craft_asset_identity import craft_output_asset_id
from .creative_craft_output_port import (
    CraftAdoptionExecutor, CraftArtifactAdoptionPlan, CraftDurableReceiptSink,
    ResolvingCraftOutputAdoptionPort,
)
from .creative_craft_output_resolver import (
    CraftAssetIdFn, Registry089CraftAssetResolver,
)


class CraftAdoptionNotWiredError(RuntimeError):
    """Un colaborador real de adopción no está cableado todavía (pre-GO)."""


class StubCraftAdoptionExecutor:
    """``CraftAdoptionExecutor`` inerte: falla CERRADO si se invoca (pre-GO).

    En el GO se sustituye por el executor real sobre el transporte final-only de SC
    (``adopt_google_staging_once``).
    """

    def adopt(self, plan: "CraftArtifactAdoptionPlan"):
        raise CraftAdoptionNotWiredError(
            "El CraftAdoptionExecutor real (transporte final-only de SC) no está "
            "cableado; la adopción no se abre hasta el GO.")


class StubCraftDurableReceiptSink:
    """``CraftDurableReceiptSink`` inerte: falla CERRADO si se invoca (pre-GO).

    En el GO se sustituye por el sink real sobre la autoridad 114 de Interfaz, que
    persiste cada StorageReceipt donde ``_evidence`` del worker lo re-lee.
    """

    def record(self, lease, ordinal: int, receipt) -> None:
        raise CraftAdoptionNotWiredError(
            "El CraftDurableReceiptSink real (autoridad 114) no está cableado; "
            "la adopción no se abre hasta el GO.")


def build_craft_output_adoption_port(
        connection, user: dict, *, uonify_project_id: str | None = None,
        lock_reads: bool = True,
        asset_id_fn: "CraftAssetIdFn" = craft_output_asset_id,
        executor: "CraftAdoptionExecutor | None" = None,
        sink: "CraftDurableReceiptSink | None" = None,
        ) -> ResolvingCraftOutputAdoptionPort:
    """Compone el port de adopción con el resolver 089 real y colaboradores.

    Por defecto ``executor``/``sink`` son STUB que fallan cerrado (pre-GO).  En el GO
    se pasan los reales y el resto queda idéntico.  ``asset_id_fn`` es, por defecto, la
    función SEED COMPARTIDA de SC (fuente única); no se reimplementa aquí.

    Construir el port NO tiene efecto externo; no abre dispatch ni arranca el worker.
    """
    resolver = Registry089CraftAssetResolver(
        connection, user, asset_id_fn,
        uonify_project_id=uonify_project_id, lock_reads=lock_reads)
    return ResolvingCraftOutputAdoptionPort(
        resolver,
        executor if executor is not None else StubCraftAdoptionExecutor(),
        sink if sink is not None else StubCraftDurableReceiptSink())
