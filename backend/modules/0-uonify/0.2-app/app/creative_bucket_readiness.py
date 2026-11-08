"""Comprobaciones mínimas de un bucket privado antes de guardar medios creativos."""

from dataclasses import dataclass
import re


_BUCKET = re.compile(r'[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]\Z')
_LOCATION = re.compile(r'[A-Z][A-Z0-9-]{2,30}\Z')


@dataclass(frozen=True)
class BucketReadiness:
    bucket: str
    location: str
    ready: bool
    missing: tuple[str, ...]


def bucket_metadata_endpoint(bucket: str) -> str:
    if not isinstance(bucket, str) or not _BUCKET.fullmatch(bucket) or '..' in bucket:
        raise ValueError('Bucket no válido.')
    return f'https://storage.googleapis.com/storage/v1/b/{bucket}'


def check_bucket(metadata: dict, bucket: str,
                 expected_location: str) -> BucketReadiness:
    """No equipara PAP heredada sin evidencia a protección confirmada."""
    bucket_metadata_endpoint(bucket)
    # F9(c): GCS devuelve la location en MAYÚSCULAS ('US-CENTRAL1'); Vertex/el loader la manejan en
    # minúsculas ('us-central1'). Normaliza ambos lados a MAYÚSCULAS para comparar convención-insensible
    # (la generación ya escribe con settings.creative_output_location='US-CENTRAL1').
    if not isinstance(expected_location, str):
        raise ValueError('Ubicación GCS no válida.')
    expected_norm = expected_location.upper()
    if not _LOCATION.fullmatch(expected_norm):
        raise ValueError('Ubicación GCS no válida.')
    if not isinstance(metadata, dict) or metadata.get('name') != bucket:
        raise ValueError('Metadatos de otro bucket o incompletos.')
    iam = metadata.get('iamConfiguration')
    iam = iam if isinstance(iam, dict) else {}
    uniform = iam.get('uniformBucketLevelAccess')
    uniform = uniform if isinstance(uniform, dict) else {}
    versioning = metadata.get('versioning')
    versioning = versioning if isinstance(versioning, dict) else {}
    missing = []
    meta_location = metadata.get('location')
    if not isinstance(meta_location, str) or meta_location.upper() != expected_norm:
        missing.append('ubicación esperada')
    if uniform.get('enabled') is not True:
        missing.append('acceso uniforme IAM')
    if iam.get('publicAccessPrevention') != 'enforced':
        missing.append('prevención pública explícita')
    if versioning.get('enabled') is not True:
        missing.append('versionado de objetos')
    return BucketReadiness(bucket, expected_norm, not missing, tuple(missing))
