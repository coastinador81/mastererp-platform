"""Contrato offline para crear el bucket creativo privado cuando se autorice."""

from dataclasses import dataclass
import re
from urllib.parse import urlencode

from .creative_bucket_readiness import BucketReadiness, check_bucket


_PROJECT = re.compile(r"[a-z][a-z0-9-]{4,61}[a-z0-9]\Z")
_BUCKET = re.compile(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\Z")
_LOCATION = re.compile(r"[A-Z][A-Z0-9-]{2,30}\Z")


@dataclass(frozen=True)
class BucketBootstrapRequest:
    method: str
    endpoint: str
    body: dict
    project: str
    bucket: str
    location: str


def bucket_bootstrap_request(
        project: str, bucket: str, *,
        location: str = "EUROPE-WEST1") -> BucketBootstrapRequest:
    if (not isinstance(project, str) or not _PROJECT.fullmatch(project)
            or not isinstance(bucket, str) or not _BUCKET.fullmatch(bucket)
            or bucket.startswith(("goog", "g00g"))
            or not isinstance(location, str)
            or not _LOCATION.fullmatch(location)):
        raise ValueError("Configuración del bucket creativo no válida.")
    endpoint = (
        "https://storage.googleapis.com/storage/v1/b?"
        + urlencode({"project": project, "projection": "full"}))
    body = {
        "name": bucket,
        "location": location,
        "iamConfiguration": {
            "uniformBucketLevelAccess": {"enabled": True},
            "publicAccessPrevention": "enforced",
        },
        "versioning": {"enabled": True},
        "labels": {"managed-by": "uonify", "purpose": "creative-media"},
    }
    return BucketBootstrapRequest(
        "POST", endpoint, body, project, bucket, location)


def bucket_bootstrap_completed(
        request: BucketBootstrapRequest, response: dict) -> BucketReadiness:
    if not isinstance(request, BucketBootstrapRequest):
        raise ValueError("Creación del bucket creativo no válida.")
    readiness = check_bucket(response, request.bucket, request.location)
    if not readiness.ready:
        raise ValueError("Google no confirmó todos los controles del bucket.")
    if response.get("labels") != request.body["labels"]:
        raise ValueError("Google no confirmó la titularidad lógica del bucket.")
    return readiness
