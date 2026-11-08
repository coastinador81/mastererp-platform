"""Bucket de generación del flujo de medios en el PROYECTO DEL CLIENTE (Lote A, M1).

Sustituye la allowlist de configuración (`settings.creative_output_buckets`): la salida de Veo va a
un bucket del PROYECTO DEL CLIENTE, co-ubicado en us-central1 (junto a Veo), guardado por-cliente en
su conexión Cloud. Este módulo VALIDA y normaliza bucket+proyecto+location del cliente y da la raíz
`gs://` de la salida; NO llama a GCS. El ledger minta el `output_prefix` DENTRO de este bucket y el
transporte valida el `storageUri` contra ese prefijo autoritativo. Puro y fail-closed.

Invariantes del veredicto de medios (Consultor): (i) el bucket es del CLIENTE (su proyecto);
(ii) la escritura de generación usa la credencial del cliente (su facturación); el WORKER de montaje
usa credencial reducida aparte (ver `creative_media_worker_credential`). La proyección card-safe
mantiene el `gs://`/project-id fuera del modelo/navegador."""
from __future__ import annotations

import re
from dataclasses import dataclass

# Location en MAYÚSCULAS como en creative_bucket_readiness. Veo es regional en us-central1 → el
# bucket de GENERACIÓN se co-ubica ahí (condición del Consultor).
_LOCATION_VEO = "US-CENTRAL1"
# Bucket existente del cliente: nombre GCS válido (admite puntos; sin '..').
_BUCKET = re.compile(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]\Z")
# Project id de GCP: 6–30, minúsculas/cifras/guiones, empieza por letra, no acaba en guion.
_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,28}[a-z0-9]\Z")


class GenerationBucketError(Exception):
    """Fail-closed: el bucket de generación del cliente no es válido o no está co-ubicado."""


@dataclass(frozen=True)
class ClientGenerationBucket:
    """Bucket de salida de generación en el proyecto del cliente, co-ubicado con Veo."""
    bucket: str
    project_id: str
    location: str

    def __post_init__(self) -> None:
        if (not isinstance(self.bucket, str) or not _BUCKET.fullmatch(self.bucket)
                or ".." in self.bucket):
            raise GenerationBucketError("El bucket del cliente no es válido.")
        if not isinstance(self.project_id, str) or not _PROJECT.fullmatch(self.project_id):
            raise GenerationBucketError("El project_id del cliente no es válido.")
        if not isinstance(self.location, str) or self.location.upper() != _LOCATION_VEO:
            raise GenerationBucketError(
                "El bucket de generación debe estar co-ubicado en us-central1 (Veo).")

    @property
    def gs_root(self) -> str:
        """Raíz `gs://` de la salida; el ledger añade el prefijo por-intento. Interno (card-safe)."""
        return f"gs://{self.bucket}"


def resolve_client_generation_bucket(bucket: str, project_id: str,
                                     location: str) -> ClientGenerationBucket:
    """Valida el bucket de generación del cliente (bucket+proyecto+location). Fail-closed.

    `bucket`/`project_id`/`location` los extrae el llamador de la conexión Cloud del cliente (donde
    se guarda su bucket elegido/creado). Sustituye la allowlist de configuración de Uonify."""
    return ClientGenerationBucket(bucket=bucket, project_id=project_id, location=location)
