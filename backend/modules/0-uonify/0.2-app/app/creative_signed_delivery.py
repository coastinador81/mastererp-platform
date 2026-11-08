"""Entrega de PREVIEW: URL firmada GCS v4 GET de un clip ADOPTADO del propio dueño.

NO sube bytes, NO adopta, NO abre dispatch, NO hace HTTP aquí: solo valida y delega la firma
a un firmante IAM `signBlob` INYECTADO. Aplica las condiciones del Consultor
(revisiones/20261026-VEREDICTO-RUNNER-CLIPS-ONLY.md §2.3), staged + INERTE (sin llamador):
  1. Ownership fail-closed ANTES de firmar: solo un objeto adoptado del dueño (identidad §H.3
     uri/bucket+object+generation+sha256 del snapshot 089). Si no → raise, no se firma.
  2. Nombre de objeto OPACO (uuid) en el bucket DEL CLIENTE: la URL V4 expone bucket+ruta en
     claro, así que el nombre no debe filtrar project id, hashes, ids de modelo ni estructura
     interna; y el bucket debe estar en la allowlist de buckets del cliente (su Google).
  3. TTL corto y acotado (techo ≤ 15 min; el valor exacto, ≤ techo, lo decide la UX del dueño).
  4. Firma vía firmante IAM signBlob (serviceAccountTokenCreator, SIN clave), credencial
     acotada (nunca cloud-platform): el mecanismo concreto lo inyecta/verifica interfaz+Consultor.
Salida card-safe (D-PROTECCION): SOLO la URL temporal + etiqueta + €; nunca gs://, project id,
USD, hashes.
"""

from dataclasses import dataclass
import re
from typing import Protocol, runtime_checkable


# §2.3.3: techo duro del TTL del preview (15 min). El valor exacto (≤ techo) = UX del dueño.
_MAX_TTL_SECONDS = 900
_SHA = re.compile(r'[0-9a-f]{64}\Z')
_BUCKET = re.compile(r'[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]\Z')
# §2.3.2: objeto de preview con nombre OPACO — segmentos uuid + extensión de media; sin
# segmentos legibles (creative/staging/…, ids de modelo, hashes) que revelen estructura interna.
_OPAQUE_OBJECT = re.compile(
    r'(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)*'
    r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    r'\.(?:mp4|png|jpg|jpeg|wav)\Z')


class SignedDeliveryError(Exception):
    """Fail-closed: el objeto no es un clip adoptado del dueño, o su forma no es segura de firmar."""


@dataclass(frozen=True)
class AdoptedClipRef:
    """Identidad §H.3 del clip ADOPTADO (del snapshot 089) que se puede previsualizar."""
    owner_user_id: str
    bucket: str
    object_name: str
    generation: int
    sha256: str
    mime_type: str


@dataclass(frozen=True)
class SignedPreview:
    """Card-safe: SOLO la URL temporal + etiqueta + € máximo; nada interno."""
    signed_url: str
    expires_in_seconds: int
    label: str
    eur_display_max: str


@runtime_checkable
class GcsV4Signer(Protocol):
    """Firmante IAM signBlob INYECTADO (serviceAccountTokenCreator, sin clave; version='v4').

    Lo cablea interfaz con el mecanismo verificado contra el código (ADK GcsArtifactService
    `get_signed_url` / `google-auth` iam.Signer). Aquí nunca se descarga clave ni se usa
    `cloud-platform`. Devuelve una URL https de solo-lectura (GET) ya firmada.
    """

    def signed_get_url(self, *, bucket: str, object_name: str, generation: int,
                       expires_in_seconds: int) -> str:
        ...


def signed_clip_preview(
        clip: AdoptedClipRef, *, owner_user_id: str, label: str, eur_display_max: str,
        signer: GcsV4Signer, client_owned_buckets: tuple[str, ...],
        ttl_seconds: int = _MAX_TTL_SECONDS) -> SignedPreview:
    """Firma una GET V4 de solo-lectura del clip adoptado del dueño. Todas las comprobaciones
    son PRE-firma y fail-closed; una que falle lanza `SignedDeliveryError` sin firmar nada."""
    # §2.3.1 — ownership fail-closed ANTES de firmar.
    if not isinstance(clip, AdoptedClipRef):
        raise SignedDeliveryError('Referencia de clip no válida.')
    if not isinstance(owner_user_id, str) or not owner_user_id or clip.owner_user_id != owner_user_id:
        raise SignedDeliveryError('El clip no pertenece al dueño que solicita el preview.')
    if (not isinstance(clip.sha256, str) or not _SHA.fullmatch(clip.sha256)
            or not isinstance(clip.generation, int) or isinstance(clip.generation, bool)
            or clip.generation <= 0):
        raise SignedDeliveryError('Identidad del clip adoptado incompleta o no válida.')
    # §2.3.2 — bucket del CLIENTE + nombre OPACO (no filtra estructura interna).
    if (not isinstance(clip.bucket, str) or not _BUCKET.fullmatch(clip.bucket)
            or clip.bucket not in tuple(client_owned_buckets)):
        raise SignedDeliveryError('El preview solo firma sobre un bucket del cliente autorizado.')
    if not isinstance(clip.object_name, str) or not _OPAQUE_OBJECT.fullmatch(clip.object_name):
        raise SignedDeliveryError('El nombre del objeto de preview no es opaco (uuid).')
    # §2.3.3 — TTL acotado al techo.
    if (not isinstance(ttl_seconds, int) or isinstance(ttl_seconds, bool)
            or not 0 < ttl_seconds <= _MAX_TTL_SECONDS):
        raise SignedDeliveryError('TTL de preview fuera del techo permitido.')
    if not isinstance(signer, GcsV4Signer):
        raise SignedDeliveryError('Firmante IAM no válido.')
    url = signer.signed_get_url(
        bucket=clip.bucket, object_name=clip.object_name,
        generation=clip.generation, expires_in_seconds=ttl_seconds)
    # Defensa en profundidad card-safe: la URL firmada nunca debe arrastrar un gs:// ni no ser https.
    if not isinstance(url, str) or not url.startswith('https://') or 'gs://' in url:
        raise SignedDeliveryError('La URL firmada tiene una forma inesperada.')
    return SignedPreview(url, ttl_seconds, label, eur_display_max)
