"""Identidad determinista y linaje de una salida Craft adoptada (SEED v1).

FUENTE ÚNICA DE VERDAD del asset_id de una salida Craft y de su linaje de adopción. La
importan: el registro del envelope (al asignar asset_id), el validador del registry
(_validate_lineage, rama 'craft_adoption') y el resolver de ArtCraft (al reconstruir).
No reimplementar el uuid5 ni las reglas en otro sitio (si divergen, el asset_id no casa
y la resolución falla). Puro, con tipos primitivos y sin dependencias de módulos de
dominio, para que cualquiera lo importe sin ciclos.

Contrato: contracts/google-craft-registration-contract.md (§2–§4). SEED v1 confirmado
con ArtCraft el 19-10-2026: subconjunto (owner, escrow, candidate, dispatch, ordinal).
"""

import re
from uuid import NAMESPACE_URL, UUID, uuid5


CRAFT_ASSET_ID_SEED_VERSION = 1
CRAFT_ADOPTION_ORIGIN = "craft_adoption"
_SEED_PREFIX = "uonify:craft:v1:"
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_REF_KEYS = {"escrowId", "candidateId", "dispatchId", "ordinal", "role", "kind",
             "relativePath", "mimeType", "byteSize", "sha256"}


def _canonical_uuid(value: object, label: str) -> str:
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        raise ValueError(f"{label} de la salida Craft no es UUID.") from None


def craft_output_asset_id(owner_user_id: str, escrow_id: str, candidate_id: str,
                          dispatch_id: str, ordinal: int) -> str:
    """asset_id determinista (SEED v1) de una salida Craft en un escrow sellado.

    Normalización fija (idéntica en el escritor y en el resolver): UUID canónicos en
    minúscula (str(UUID(x))), ordinal en base 10 sin relleno, prefijo y separador
    exactos, uuid5 sobre NAMESPACE_URL. Lanza ValueError si algún campo no es válido.
    """
    if not isinstance(ordinal, int) or isinstance(ordinal, bool) or ordinal < 0:
        raise ValueError("ordinal de la salida Craft no válido.")
    owner = _canonical_uuid(owner_user_id, "owner_user_id")
    escrow = _canonical_uuid(escrow_id, "escrow_id")
    candidate = _canonical_uuid(candidate_id, "candidate_id")
    dispatch = _canonical_uuid(dispatch_id, "dispatch_id")
    seed = f"{_SEED_PREFIX}{owner}:{escrow}:{candidate}:{dispatch}:{ordinal}"
    return str(uuid5(NAMESPACE_URL, seed))


def validate_craft_adoption_lineage(
        lineage: object, *, asset_id: str, owner_user_id: str, mime_type: str,
        byte_size: int, sha256: str) -> None:
    """Valida el linaje 'craft_adoption' de una revisión 089 (lanza ValueError si no).

    Set de claves exacto {origin, assetIdSeedVersion, craftRef}; craftRef cerrado a los
    10 campos; cruces de mime/byte/sha con la revisión; y —clave del contrato— el
    asset_id de la fila debe REGENERARSE del SEED a partir de craftRef (atadura 1:1 con
    la identidad estable del CraftAssetRef). No usa para buscar; es procedencia +
    verificación. No reutiliza 'craft' (reservado FilmCraft/PhotoCraft + trigger 105).
    """
    if not isinstance(lineage, dict):
        raise ValueError("Linaje craft_adoption ausente.")
    ref = lineage.get("craftRef")
    try:
        seed_asset_id = (craft_output_asset_id(
            owner_user_id, ref.get("escrowId"), ref.get("candidateId"),
            ref.get("dispatchId"), ref.get("ordinal"))
            if isinstance(ref, dict) else None)
    except ValueError:
        seed_asset_id = None
    if (set(lineage) != {"origin", "assetIdSeedVersion", "craftRef"}
            or lineage.get("origin") != CRAFT_ADOPTION_ORIGIN
            or lineage.get("assetIdSeedVersion") != CRAFT_ASSET_ID_SEED_VERSION
            or not isinstance(ref, dict) or set(ref) != _REF_KEYS
            or not isinstance(ref.get("ordinal"), int)
            or isinstance(ref.get("ordinal"), bool) or ref["ordinal"] < 0
            or not isinstance(ref.get("role"), str) or not ref["role"]
            or not isinstance(ref.get("kind"), str) or not ref["kind"]
            or not isinstance(ref.get("relativePath"), str) or not ref["relativePath"]
            or not isinstance(ref.get("byteSize"), int)
            or isinstance(ref.get("byteSize"), bool) or ref["byteSize"] <= 0
            or not _HASH.fullmatch(str(ref.get("sha256", "")))
            or ref.get("mimeType") != mime_type
            or ref.get("byteSize") != byte_size
            or ref.get("sha256") != sha256
            or seed_asset_id is None
            or asset_id != seed_asset_id):
        raise ValueError(
            "El linaje craft_adoption no liga el CraftAssetRef con su asset "
            "determinista.")
