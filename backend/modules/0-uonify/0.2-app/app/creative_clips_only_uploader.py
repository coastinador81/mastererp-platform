"""UPLOADER del fotograma de entrada clips-only (PARTE 2): sube la foto del cliente a SU GCS y produce el
recibo de propiedad VERIFICADO para el input-ownership gate (image→clip referencia-de-sujeto).

Reusa la infra de assets §E-§H APROBADA (creative_storage_transport: storage_upload + upload_once), que son
byte-idénticos a snap-rc2 (condición (c) del Consultor verificada). NO reimplanta escritura GCS.

CONDICIONES DEL CONSULTOR (a–e) aplicadas:
  (a) la escritura GCS usa el Bearer PATH A (user-OAuth del CLIENTE), inyectado; NUNCA una SA de Uonify; el
      bucket de ENTRADA viene del allowlist de config (settings.creative_output_buckets), no del cuerpo.
  (b) el StorageReceipt lo devuelve upload_once, que LEE generation del objeto REAL y VERIFICA sha256 contra el
      byte stream (creative_storage_transport); fail-closed si no verifica. No se fabrica ni se pre-calcula el
      recibo: sale del POST real.
  (c) storage_upload/upload_once = infra RC2/§E-§H aprobada (byte-idéntica a snap-rc2). ✓
  (d) el recibo (uri gs://{bucket}/{name}+generation+sha256) es EXACTO del objeto subido; bind_google_owned_inputs
      (en el live_provider) liga ESE recibo al input de la request.
  (e) límites tipo/tamaño (imagen, no ejecutable) + path namespacea por dueño+hash
      (creative/users/{owner}/assets/{uuid}/{sha}) → no sobrescribe objetos ajenos; idempotente por ifGenerationMatch=0.

REGISTRO DEL INPUT SUBIDO — ADJUDICADO por el Consultor (puerto 1): NO un source_job_id SINTÉTICO (falsearía la
procedencia «generado»). El input subido es procedencia 'uploaded' (sin source_job_id). El registro guarda el
RECIBO VERIFICADO (uri+generation+sha256), owned por el cliente, recuperable por asset_id+revisión, que alimenta
bind_google_owned_inputs; bucket de ENTRADA en el allowlist. El ESQUEMA (source_job_id NULLABLE + campo
procedencia, o tabla aparte) toca la BIBLIOTECA DE ASSETS de ArtCraft (§B/§C, 089) → se COORDINA con ArtCraft +
interfaz, y la migración concreta vuelve al Consultor + REA. Por eso el registro queda como PUERTO INYECTADO
`asset_recorder` aquí; el live_provider recupera el recibo con el `input_receipt_resolver` simétrico (misma store,
asset_id+revisión EXACTA, authorization_state='allowed'). NO invento la persistencia; la define ArtCraft.

STAGED + INERTE: función/clase puras sobre puertos inyectados (token/session/clock/bucket/asset_recorder); la ruta
NO se monta (routes() sin include). D-PROTECCIÓN: la respuesta devuelve un assetId OPACO + metadatos de imagen,
NUNCA gs://, generation ni sha256 (card-safe). Fail-closed: cualquier incoherencia ⇒ ClipsOnlyUploadError.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable
from uuid import UUID, uuid4

import requests

from .creative_storage_transport import upload_once, upload_resumable_once
from .creative_storage_contracts import (ResumableStorageRequest, StorageReceipt,
                                         storage_upload)

_ALLOWED_MIME = ("image/jpeg", "image/png")
_MAX_BYTES = 10 * 1024 * 1024          # límite preliminar; el Consultor fija el def. según entrada Veo.
_MIN_BYTES = 1


class ClipsOnlyUploadError(Exception):
    """Fail-closed: no se pudo subir/verificar/registrar el fotograma de entrada."""


@dataclass(frozen=True)
class ClipInputAssetRef:
    """Lo que el frontend recibe para enganchar al generar/cotizar. OPACO: sin gs://, generation ni sha256."""
    asset_id: str
    mime_type: str
    byte_size: int


def upload_clip_input(*, owner_id: str, mime_type: str, data: bytes, bucket: str,
                      token: str, session: requests.Session, expected_location: str,
                      asset_recorder: Callable[..., None]) -> ClipInputAssetRef:
    """Sube UNA imagen al GCS del cliente (PATH A) y devuelve una ref opaca. Fail-closed.

    `asset_recorder(owner_id, asset_id, receipt)` persiste el recibo verificado (mecanismo exacto = puerto
    inyectado, Consultor fija el registro del input subido). El recibo nunca se expone al cliente."""
    if mime_type not in _ALLOWED_MIME:
        raise ClipsOnlyUploadError("Tipo de imagen no admitido (solo JPG/PNG).")
    if not isinstance(data, (bytes, bytearray)) or not (_MIN_BYTES <= len(data) <= _MAX_BYTES):
        raise ClipsOnlyUploadError("Imagen vacía o demasiado grande.")
    if not isinstance(token, str) or not token:
        raise ClipsOnlyUploadError("Credencial de subida no válida.")
    asset_id = str(uuid4())
    # storage_upload calcula sha256/name (creative/users/{owner}/assets/{asset}/{sha}.{ext}) y devuelve
    # StorageRequest (multipart) o ResumableStorageRequest (grande) según tamaño. Se despacha al upload que
    # corresponde (mismo patrón que creative_craft_output_staging); ambos devuelven el StorageReceipt con
    # generation del objeto REAL + sha256 verificado (condición b).
    request = storage_upload(bucket, owner_id, asset_id, mime_type, bytes(data))
    if isinstance(request, ResumableStorageRequest):
        receipt = upload_resumable_once(request, token, session,
                                        expected_location=expected_location)
    else:
        receipt = upload_once(request, token, session,
                              expected_location=expected_location)
    if not isinstance(receipt, StorageReceipt):
        raise ClipsOnlyUploadError("La subida no devolvió un recibo verificable.")
    # Registro del recibo verificado (puerto inyectado; mecanismo exacto = decisión del Consultor).
    # Fix re-subida: el recorder devuelve el asset_id EFECTIVO (el existente si dedupe por contenido) →
    # la ref al frontend usa ESE id resoluble, no el recién minteado que el ON CONFLICT no insertó.
    effective_id = asset_recorder(owner_id=owner_id, asset_id=asset_id, receipt=receipt)
    ref_id = effective_id if isinstance(effective_id, str) and effective_id else asset_id
    return ClipInputAssetRef(asset_id=ref_id, mime_type=mime_type, byte_size=receipt.byte_size)
