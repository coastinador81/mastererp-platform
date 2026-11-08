"""Allowlist versionada de Craft validada por ART-02.

Este módulo no descubre binarios ni abre procesos. Congela únicamente las
operaciones observadas con releases oficiales para que el preflight falle de
forma cerrada ante una versión u operación desconocida.
"""

from dataclasses import dataclass


CAPABILITY_MATRIX_SHA256 = (
    "6ab5507bb6ac8d2ff33672c5c92d66b8ea3b1ac7cda2b11de21ca8789bc969e5"
)
CRAFT_CONTRACT_SCHEMA_SHA256 = (
    "fdcb5202f1e9fdd9ae4606937d1830a12a8984fae54c5dd7a51b1782238e248d"
)


@dataclass(frozen=True)
class CraftCapability:
    engine: str
    version: str
    operations: tuple[str, ...]
    input_mime_types: tuple[str, ...]
    output_mime_types: tuple[str, ...]
    commands: tuple[str, ...]


_CAPABILITIES = {
    ("photocraft", "0.10.0"): CraftCapability(
        "photocraft", "0.10.0", ("image_edit",),
        ("image/png", "image/jpeg", "image/webp"), ("image/png",),
        ("doc_open", "image.crop", "layer.newFillLayer.solidColor", "doc_inspect",
         "doc_save", "doc_export"),
    ),
    ("effectcraft", "0.11.1"): CraftCapability(
        "effectcraft", "0.11.1", ("motion_graphics",),
        ("image/png", "image/jpeg", "image/webp"), ("image/png",),
        ("comp.new", "file.import", "layer.newText", "add_keyframe", "save_project",
         "renderQueue.add", "renderQueue.render"),
    ),
    ("filmcraft", "0.9.0"): CraftCapability(
        "filmcraft", "0.9.0", ("video_export",),
        ("image/png", "image/jpeg", "image/webp", "video/mp4", "audio/wav",
         "audio/mpeg"),
        ("video/mp4", "application/json"),
        ("file.newSequence", "media_import", "timeline.place", "clip.audioGain",
         "mixer.setKeyframe", "essentialSound.setType", "essentialSound.set",
         "essentialSound.generateDucking", "essentialSound.autoMatch",
         "file.saveAs", "file.exportMedia"),
    ),
}


def capability_for(engine: str, version: str, operation: str) -> CraftCapability:
    """Devuelve una capacidad exacta o rechaza; no usa compatibilidad implícita."""
    capability = _CAPABILITIES.get((engine, version))
    if capability is None or operation not in capability.operations:
        raise ValueError("Motor, versión u operación Craft no autorizados por ART-02.")
    return capability


def pinned_capabilities() -> tuple[CraftCapability, ...]:
    return tuple(_CAPABILITIES[key] for key in sorted(_CAPABILITIES))
