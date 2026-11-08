"""Copia de PREVIEW verificada por contenido: del clip ADOPTADO (089, nombre canónico
INTERNO) a un objeto de nombre OPACO en un bucket efímero del cliente, para poder firmarlo.

Aplica el dictamen del Consultor (revisiones/20261026-VEREDICTO-CODIGO-RUNNER-CLIPS-ONLY.md
§2.3.2, opción A), staged + INERTE (sin llamador; no hace HTTP ni toca GCS aquí: delega el
copiado físico a un `PreviewCopyPort` INYECTADO):
  (i)   ownership sobre el objeto ADOPTADO (089) ANTES de copiar; si no es del dueño → raise.
  (ii)  la copia server-side SOLO si (i) pasa, anclada por la `generation` del adoptado.
  (iii) VERIFICAR POR CONTENIDO que `copia.sha256 == adoptado.sha256` (y mime/bytes) ANTES de
        devolver la referencia firmable; si no casa → borrar la copia y raise (fail-closed:
        nunca se devuelve un objeto sin verificar, así que `signed_delivery` nunca lo firma).
  (iv)  nombre OPACO por-petición (uuid) en un bucket EFÍMERO del cliente (su Google) cuyo
        ciclo de vida por edad borra la copia; el adoptado canónico queda INTERNO y nunca se
        firma.

El objeto devuelto es un `AdoptedClipRef` que `creative_signed_delivery.signed_clip_preview`
acepta tal cual. El adoptado canónico NO se expone: solo la copia opaca es firmable.
"""

from dataclasses import dataclass
from typing import Protocol, runtime_checkable
from uuid import UUID, uuid4
import re

from .creative_signed_delivery import AdoptedClipRef


_SHA = re.compile(r'[0-9a-f]{64}\Z')
_BUCKET = re.compile(r'[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]\Z')
# Extensión opaca admitida (coincide con `_OPAQUE_OBJECT` de creative_signed_delivery).
_MIME_EXT = {'video/mp4': 'mp4', 'image/png': 'png', 'image/jpeg': 'jpg',
             'audio/wav': 'wav'}


class PreviewCopyError(Exception):
    """Fail-closed: el adoptado no es del dueño, o la copia no se pudo verificar por contenido."""


@dataclass(frozen=True)
class CopiedObject:
    """Recibo del copiado físico que devuelve el port (la COPIA, no el adoptado)."""
    bucket: str
    name: str
    generation: int
    mime_type: str
    byte_size: int
    sha256: str


@runtime_checkable
class PreviewCopyPort(Protocol):
    """Copiado físico server-side INYECTADO (lo cablea interfaz; el Consultor verifica).

    `copy_to_opaque` copia el objeto fuente (anclado por su generation) al objeto opaco
    destino y devuelve el recibo de la COPIA con su sha256 calculado del contenido escrito.
    `delete` borra una copia no verificada (cleanup fail-closed). Aquí no se descarga clave
    ni se usa `cloud-platform`; la credencial va acotada al bucket del cliente.
    """

    def copy_to_opaque(self, *, source_bucket: str, source_object: str,
                       source_generation: int, target_bucket: str,
                       target_object: str) -> CopiedObject: ...

    def delete(self, *, bucket: str, object_name: str, generation: int) -> None: ...


def make_opaque_preview_copy(
        adopted: AdoptedClipRef, *, owner_user_id: str, port: PreviewCopyPort,
        client_owned_buckets: tuple[str, ...],
        ephemeral_preview_buckets: tuple[str, ...],
        target_bucket: str) -> AdoptedClipRef:
    """Copia el clip adoptado del dueño a un objeto opaco efímero verificado por contenido.
    Todas las comprobaciones de identidad son PRE-copia; la verificación de contenido es
    POST-copia y, si falla, borra la copia. Devuelve la referencia firmable (opaca)."""
    # (i) ownership + identidad §H.3 del ADOPTADO, fail-closed ANTES de copiar.
    if not isinstance(adopted, AdoptedClipRef):
        raise PreviewCopyError('Referencia de clip adoptado no válida.')
    if (not isinstance(owner_user_id, str) or not owner_user_id
            or adopted.owner_user_id != owner_user_id):
        raise PreviewCopyError('El clip adoptado no pertenece al dueño que lo solicita.')
    if (not isinstance(adopted.sha256, str) or not _SHA.fullmatch(adopted.sha256)
            or not isinstance(adopted.generation, int)
            or isinstance(adopted.generation, bool) or adopted.generation <= 0):
        raise PreviewCopyError('Identidad del clip adoptado incompleta o no válida.')
    ext = _MIME_EXT.get(adopted.mime_type)
    if ext is None:
        raise PreviewCopyError('Tipo de medio no admitido para preview.')
    # (iv) destino: bucket EFÍMERO del cliente + nombre OPACO por-petición.
    if (not isinstance(target_bucket, str) or not _BUCKET.fullmatch(target_bucket)
            or target_bucket not in tuple(client_owned_buckets)
            or target_bucket not in tuple(ephemeral_preview_buckets)):
        raise PreviewCopyError(
            'El destino debe ser un bucket efímero del cliente autorizado.')
    target_object = f'{uuid4()}.{ext}'
    if not isinstance(port, PreviewCopyPort):
        raise PreviewCopyError('Port de copia de preview no válido.')
    # (ii) copia server-side SOLO tras pasar (i), anclada por la generation del adoptado.
    copied = port.copy_to_opaque(
        source_bucket=adopted.bucket, source_object=adopted.object_name,
        source_generation=adopted.generation, target_bucket=target_bucket,
        target_object=target_object)
    # (iii) verificación POR CONTENIDO; si algo no casa, borrar la copia y fallar cerrado.
    mismatch = (not isinstance(copied, CopiedObject)
                or copied.bucket != target_bucket or copied.name != target_object
                or copied.sha256 != adopted.sha256
                or copied.mime_type != adopted.mime_type
                or not isinstance(copied.generation, int)
                or isinstance(copied.generation, bool) or copied.generation <= 0)
    if mismatch:
        _best_effort_delete(port, target_bucket, target_object,
                            getattr(copied, 'generation', 0))
        raise PreviewCopyError(
            'La copia de preview no coincide por contenido con el clip adoptado.')
    return AdoptedClipRef(
        owner_user_id=owner_user_id, bucket=copied.bucket,
        object_name=copied.name, generation=copied.generation,
        sha256=copied.sha256, mime_type=copied.mime_type)


def _best_effort_delete(port: PreviewCopyPort, bucket: str, object_name: str,
                        generation: object) -> None:
    """Borra la copia no verificada sin enmascarar el fallo original."""
    try:
        gen = generation if isinstance(generation, int) and not isinstance(
            generation, bool) and generation > 0 else 0
        port.delete(bucket=bucket, object_name=object_name, generation=gen)
    except Exception:
        pass
