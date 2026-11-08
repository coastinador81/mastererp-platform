"""Resolver `assetId → VeoFrameGcsReference` para el director clips-only — staged + inerte.

El frontend sube la foto (creative_clips_only_upload_route) y recibe un `assetId` OPACO (= PK `id` de
creative_owned_inputs, migr 132/140). La orquestación del clip necesita la IDENTIDAD GCS del primer
fotograma (uri + generation + sha256 + mime + bytes) para que ArtCraft compile el `veo_first_frame_request`
y para que el gate §H ate por esa identidad exacta. Este resolver hace ese puente, SOLO por lectura.

Fail-closed (anti-IDOR / anti-swap): filtra por (user_id de la SESIÓN, id=assetId); exige
`authorization_state='allowed'` y `kind='image'`. Un asset de otro usuario, revocado o de otro tipo
resuelve 0 filas / se rechaza. El `assetId` es un HANDLE opaco, NO la clave de despacho (esa es el
sha256, que el gate §H re-verifica aguas abajo). No crea nada, no llama proveedores, no abre gates.
"""
from __future__ import annotations

from .creative_veo_first_frame import VeoFrameGcsReference


class ClipsOnlyFrameResolverError(Exception):
    """El input subido no existe, no es del dueño, está revocado o no es una imagen."""


def resolve_clips_only_frame(c, *, user_id: str,
                             asset_id: str) -> VeoFrameGcsReference:
    """Resuelve el `assetId` del dueño a la identidad GCS de su primer fotograma.

    Lee la fila INMUTABLE de creative_owned_inputs por (user_id, id) y construye el
    `VeoFrameGcsReference` con la identidad VERIFICADA en la subida (upload_once ya validó
    mime/bytes/sha256/generation del objeto real). `uri = gs://{bucket}/{name}`.
    """
    row = c.execute(
        """SELECT sha256, kind, mime_type, byte_size,
                  storage_bucket, storage_name, storage_generation,
                  authorization_state
             FROM creative_owned_inputs
            WHERE user_id=%s AND id=%s""",
        (str(user_id), str(asset_id))).fetchone()
    if not row:
        raise ClipsOnlyFrameResolverError('El input subido no existe o no es del dueño.')
    if row['authorization_state'] != 'allowed':
        raise ClipsOnlyFrameResolverError('El input subido no está autorizado (revocado).')
    if row['kind'] != 'image':
        raise ClipsOnlyFrameResolverError('El input subido no es una imagen.')
    return VeoFrameGcsReference(
        uri=f"gs://{row['storage_bucket']}/{row['storage_name']}",
        mime_type=row['mime_type'],
        byte_size=row['byte_size'],
        sha256=row['sha256'],
        generation=row['storage_generation'])
