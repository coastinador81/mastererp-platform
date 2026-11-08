"""Credencial del worker de medios: token GCS de ALCANCE REDUCIDO, inyectable.

SEAM LOCAL del flujo de medios (delta local, Consultor 23-10, APROBADO CON CONDICIONES,
condición 2). El worker de montaje NO reutiliza el `cloud-platform` amplio del cliente
(INV-B del veredicto de medios). Obtiene un token acotado al bucket por un PROVEEDOR INYECTABLE:
  - LOCAL: una fuente del PROYECTO DE PRUEBAS de Uonify que minta un token
    `devstorage.read_write` (o `read_only` si solo descarga), NUNCA `cloud-platform`.
  - LANZAMIENTO: la misma interfaz la cumple Workload Identity Federation (token corto keyless,
    SA acotada al bucket) — drop-in, sin reescribir el worker.

El token vive en memoria para el job: este módulo NO lo persiste ni lo registra. Puro y
fail-closed: cualquier violación (scope amplio, token vacío, bucket que no coincide, modo que no
casa) es `WorkerCredentialError` y NO devuelve token. Las ops GCS
(`creative_storage_transport` / `creative_craft_output_staging`) consumen el `str` que devuelve
`worker_gcs_token`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol


class WorkerCredentialError(Exception):
    """Fail-closed: la credencial del worker no cumple el mínimo privilegio."""


_READ_WRITE = "https://www.googleapis.com/auth/devstorage.read_write"
_READ_ONLY = "https://www.googleapis.com/auth/devstorage.read_only"
_FORBIDDEN = "https://www.googleapis.com/auth/cloud-platform"
_ALLOWED = (_READ_WRITE, _READ_ONLY)
_BUCKET = re.compile(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]\Z")


@dataclass(frozen=True)
class ReducedScopeToken:
    """Lo que entrega la fuente inyectable: un token y SU alcance declarado, acotado al bucket."""
    token: str
    scopes: tuple[str, ...]
    bucket: str
    read_only: bool

    def __post_init__(self) -> None:
        if not isinstance(self.token, str) or not self.token:
            raise WorkerCredentialError("El token del worker está vacío.")
        if (not isinstance(self.scopes, tuple) or not self.scopes
                or any(not isinstance(scope, str) or not scope for scope in self.scopes)):
            raise WorkerCredentialError("Los scopes del worker no son válidos.")
        if (not isinstance(self.bucket, str) or not _BUCKET.fullmatch(self.bucket)
                or ".." in self.bucket):
            raise WorkerCredentialError("El bucket del worker no es válido.")
        if type(self.read_only) is not bool:
            raise WorkerCredentialError("read_only no es booleano.")


class WorkerCredentialSource(Protocol):
    """Fuente inyectable del token acotado (proyecto de pruebas en local; WIF en lanzamiento)."""

    def mint(self, bucket: str, *, read_only: bool) -> ReducedScopeToken: ...


def _validate(result: object, bucket: str, read_only: bool) -> None:
    if not isinstance(result, ReducedScopeToken):
        raise WorkerCredentialError("La fuente no devolvió un ReducedScopeToken.")
    if result.bucket != bucket or result.read_only != read_only:
        raise WorkerCredentialError("La credencial no coincide con el bucket/modo pedidos.")
    scopes = set(result.scopes)
    if _FORBIDDEN in scopes:
        raise WorkerCredentialError("El worker NUNCA usa el scope cloud-platform (INV-B).")
    if not scopes.issubset(set(_ALLOWED)):
        raise WorkerCredentialError("El worker solo admite scopes devstorage acotados.")
    if read_only:
        if scopes != {_READ_ONLY}:
            raise WorkerCredentialError(
                "Modo solo-lectura: el scope debe ser exactamente devstorage.read_only.")
    elif _READ_WRITE not in scopes:
        raise WorkerCredentialError("Modo escritura: falta el scope devstorage.read_write.")


def worker_gcs_token(source: WorkerCredentialSource, bucket: str, *,
                     read_only: bool = False) -> str:
    """Token GCS de alcance REDUCIDO acotado al bucket, de la fuente inyectable.

    Fail-closed: cualquier violación es `WorkerCredentialError` (no devuelve token). El token vive
    en memoria para el job; este módulo no lo persiste ni lo registra. En el lanzamiento, `source`
    es la federación WIF (mismo contrato); en local, la fuente del proyecto de pruebas."""
    if source is None:
        raise WorkerCredentialError("Falta la fuente de credencial del worker (inyectable).")
    if not isinstance(bucket, str) or not _BUCKET.fullmatch(bucket) or ".." in bucket:
        raise WorkerCredentialError("El bucket pedido no es válido.")
    if type(read_only) is not bool:
        raise WorkerCredentialError("read_only no es booleano.")
    result = source.mint(bucket, read_only=read_only)
    _validate(result, bucket, read_only)
    return result.token
