"""Marcador canónico «sin montaje» (clips-only) para el slot `editRecipe` del binding.

El Consultor (veredicto 20261027-ADMISION-CLIPS-ONLY §C3) fijó que el `editRecipe` de una
ejecución clips-only es un **marcador de identidad «sin montaje» HASHEADO, nunca `{}`
arbitrario**. Este módulo produce ese marcador canónico y su sha256, para el slot `editRecipe`
del `ExecutionBinding` (creative_composite_quote) y su snapshot persistido
(`persist_composite_quote`).

Propiedades:
  * NO es una receta ART-02: su `kind` (`clips_only_direct_delivery`) no es ninguno de los de
    montaje (`image_edit`/`motion_graphics`/`video_assemble`), así que nunca se confunde con una
    receta de craft ni la valida `creative_edit_recipe`.
  * NUNCA alimenta un paso `craft`: el grafo clips-only (build_clips_only_execution_graph) no
    tiene craft; el entregable es el clip adoptado (089). El marcador es SOLO identidad en el
    binding/quote.
  * Determinista: mismo contenido → mismo hash (canonical_json/sha256). Inmutable.

Puro: sin red, sin DB, sin estado. Staged: las columnas exactas del marcador las confirma el
Consultor en la ronda C3 (este módulo ES esa ronda con código).
"""
from .creative_composite_quote import canonical_json, canonical_sha256

_SCHEMA_VERSION = 1
# Identidad «sin montaje»: el clip Veo adoptado es el entregable directo (sin craft/review).
_KIND = 'clips_only_direct_delivery'


def clips_only_edit_recipe() -> dict:
    """Marcador canónico «sin montaje». Contenido fijo (identidad, no parámetros)."""
    return {'schemaVersion': _SCHEMA_VERSION, 'kind': _KIND, 'montage': False}


def clips_only_edit_recipe_json() -> str:
    """JSON canónico del marcador (lo que persiste `persist_composite_quote` como snapshot)."""
    return canonical_json(clips_only_edit_recipe())


def clips_only_edit_recipe_sha256() -> str:
    """sha256 canónico del marcador = el `editRecipeSha256` del binding clips-only."""
    return canonical_sha256(clips_only_edit_recipe())
