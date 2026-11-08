"""Paso OBSERVE del flujo de medios (Lote A): mide los bytes del output del montaje y construye los
`CraftEscrowArtifact` observados ANTES del sellado, con el SEAM de transform C2PA inyectable.

Punto de inserción del re-estampado C2PA (acordado con ArtCraft): el transform (puro bytes→bytes;
en Lote B será el `resign()` de ArtCraft) se aplica SOLO a los artefactos `kind=="output"`, NUNCA al
`native_project` ni a entradas pristinas. Los bytes TRANSFORMADOS se ESCRIBEN de vuelta en
`output_root` antes de medir, de modo que el `sha256`/`byteSize` observados sean los FIRMADOS y el
staging (que RE-LEE `output_root` y exige `sha256==sellado`, `creative_craft_output_staging:114-116`)
case.

IDEMPOTENCIA (clave; la firma C2PA lleva sello RFC3161 → NO es byte-determinista): observe se llama
UNA sola vez en el camino de PRODUCCIÓN única. El reintento/resume NO re-observa (re-lee el output
persistido; el sellado create-only devuelve el prior idéntico). Esa garantía la pone el ORQUESTADOR
(su camino de resume), no esta función: por eso observe es un paso del camino de producción, nunca
del de reintento.

Fail-closed. E/S acotada a `output_root` (workspace local del montaje) + el transform inyectado."""
from __future__ import annotations

from hashlib import sha256
from pathlib import Path, PurePosixPath
from typing import Protocol

from .creative_craft_output_escrow import (
    CraftEscrowArtifact, CraftExpectedEscrowArtifact,
)


class MediaObserveError(Exception):
    """Fail-closed: el output observado no es válido o no cabe en su autoridad."""


class OutputTransform(Protocol):
    """Transform puro bytes→bytes aplicado al output antes de medir (C2PA en Lote B)."""

    def apply(self, data: bytes, *, role: str, mime_type: str) -> bytes: ...


class IdentityOutputTransform:
    """Transform por defecto de Lote A: no cambia los bytes (sin re-estampado todavía)."""

    def apply(self, data: bytes, *, role: str, mime_type: str) -> bytes:
        return data


def _safe_path(output_root: Path, relative_path: str) -> Path:
    if (not isinstance(relative_path, str) or not relative_path
            or "\\" in relative_path):
        raise MediaObserveError("La ruta de output no es relativa.")
    pure = PurePosixPath(relative_path)
    if (pure.is_absolute()
            or any(part in ("", ".", "..") for part in pure.parts)
            or pure.as_posix() != relative_path):
        raise MediaObserveError("La ruta de output sale del workspace.")
    root = output_root.resolve()
    target = (root / Path(relative_path)).resolve()
    if root != target and root not in target.parents:
        raise MediaObserveError("La ruta de output escapa de output_root.")
    return target


def observe_craft_outputs(
        output_root: Path,
        expected: tuple[CraftExpectedEscrowArtifact, ...],
        *, transform: OutputTransform) -> tuple[CraftEscrowArtifact, ...]:
    """Construye los `CraftEscrowArtifact` observados desde `output_root`, aplicando `transform`
    (C2PA) solo a los `kind=="output"` y escribiendo los bytes firmados de vuelta. Fail-closed.

    Debe llamarse UNA vez en el camino de producción única (ver idempotencia en el módulo)."""
    if not isinstance(output_root, Path):
        raise MediaObserveError("output_root debe ser una ruta local.")
    if (not isinstance(expected, tuple) or not expected
            or any(not isinstance(item, CraftExpectedEscrowArtifact)
                   for item in expected)):
        raise MediaObserveError("El conjunto de outputs esperados no es válido.")
    if transform is None or not hasattr(transform, "apply"):
        raise MediaObserveError("Falta el transform de salida (inyectable).")

    observed: list[CraftEscrowArtifact] = []
    for ordinal, item in enumerate(expected):
        if item.ordinal != ordinal:
            raise MediaObserveError("Los outputs esperados no están en orden.")
        path = _safe_path(output_root, item.relative_path)
        try:
            data = path.read_bytes()
        except OSError:
            raise MediaObserveError(
                f"No se pudo leer el output {item.relative_path}.") from None
        if item.kind == "output":
            signed = transform.apply(data, role=item.role, mime_type=item.mime_type)
            if not isinstance(signed, (bytes, bytearray)):
                raise MediaObserveError("El transform no devolvió bytes.")
            signed = bytes(signed)
            if signed != data:
                path.write_bytes(signed)  # el output_root queda con los bytes FIRMADOS
            data = signed
        # native_project (y cualquier no-output): nunca se transforma.
        byte_size = len(data)
        if byte_size < 1:
            raise MediaObserveError("Un output está vacío.")
        if byte_size > item.max_bytes:
            raise MediaObserveError(
                "El output (firmado) excede max_bytes: amplía el headroom.")
        observed.append(CraftEscrowArtifact(
            ordinal=item.ordinal, kind=item.kind, relative_path=item.relative_path,
            role=item.role, mime_type=item.mime_type, byte_size=byte_size,
            sha256=sha256(data).hexdigest()))
    return tuple(observed)
