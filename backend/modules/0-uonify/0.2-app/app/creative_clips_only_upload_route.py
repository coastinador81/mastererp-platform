"""Ruta de SUBIDA del fotograma de entrada clips-only (acto del cliente: «sube una foto»). STAGED + INERTE.

Mismo patrón que creative_generation_routes/confirmation_route (REA cond.3): require_origin (CSRF) +
require_user (owner de SESIÓN, NUNCA del cuerpo) + bucket de CONFIG (no del cuerpo). Compone: leer la imagen
→ resolver bucket de ENTRADA (allowlist settings.creative_output_buckets) + token PATH A del cliente →
upload_clip_input (sube al GCS del cliente, recibo verificado) → clips_only_record_owned_input (registra el
input 'uploaded' en creative_owned_inputs 132). Devuelve un assetId OPACO (sin gs://; D-PROTECCIÓN).

CONEXIÓN AL SUBIR (nota para el Consultor): la subida ocurre ANTES del plan/cotización, así que NO hay
validate_active_execution_scope (necesita planId); se valida la conexión del cliente como la voz (connected +
project_check.ready + scope cloud-platform + google_subject) para obtener project_id (→ bucket) + refresh (→
token PATH A). El 119 completo (proyecto==plan) se exige después, en el despacho (live_provider). La validación
de conexión al subir vuelve al Consultor con el cableado.

CICLO DE CONEXIÓN (reestructura 27-10, pedida por interfaz; REA nota operativa): NO se retiene el FOR UPDATE
de users durante la subida GCS lenta. FASE 1 (txn corta): auth + conexión + bucket + token, y se SUELTA la
conexión. FASE 2: subida GCS fuera de txn (sin lock). FASE 3: el registro del input abre su PROPIA txn corta
(_record) vía asset_recorder. A lo sumo una conexión viva a la vez; ninguna retenida durante la red.

STAGED + INERTE: routes() NO se monta (sin include_router) hasta OK Consultor + REA + dueño. cloud =
GoogleCloudProvider inyectado (como las rutas vivas); cipher = Fernet(settings.encryption_key). Fail-closed.
"""
from __future__ import annotations

import requests
from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException, Request, UploadFile

from .creative_clips_only_bucket import clips_only_output_bucket
from .creative_clips_only_live_provider import ClipsOnlyIdentity
from .creative_clips_only_owned_input import (ClipsOnlyOwnedInputError,
                                              clips_only_record_owned_input)
from .creative_clips_only_token_provider import clips_only_token_provider
from .creative_clips_only_uploader import ClipsOnlyUploadError, upload_clip_input
from .google_cloud_provider import SCOPE
from .onboarding import require_user
from .security import require_origin

_MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def routes(settings, database, cloud):
    router = APIRouter(prefix="/api/uony/threads/{thread_id}/estudio")
    cipher = Fernet(settings.encryption_key)

    def _connection_row(c, owner):
        """Conexión Cloud del cliente validada (como la voz; sin el plan, que no existe al subir)."""
        row = c.execute(
            """SELECT google_subject,project_id,status,project_check,refresh_encrypted,scope
               FROM google_cloud_connections WHERE user_id=%s""",
            (owner["id"],)).fetchone()
        checks = row.get("project_check") if row else None
        if (not row or row["google_subject"] != owner.get("google_subject")
                or row["status"] != "connected" or not isinstance(checks, dict)
                or checks.get("ready") is not True
                or SCOPE not in (row.get("scope") or "").split()):
            raise HTTPException(409, detail={"error": "cloud_not_ready",
                                             "message": "Conecta tu Google Cloud para subir."})
        return row

    def _record(*, owner_id, asset_id, receipt):
        """FASE 3: registra el input en su PROPIA txn corta (NO la de la autenticación). origin
        'product_photo' PROVISIONAL (Consultor/D-FOCO-ECOMMERCE); interfaz confirma con el dueño.
        Devuelve el asset_id EFECTIVO (fix re-subida: el existente si dedupe por contenido)."""
        with database.connect() as rc:
            return clips_only_record_owned_input(
                rc, owner_id=owner_id, asset_id=asset_id, receipt=receipt,
                origin="product_photo")

    @router.post("/uploads")
    def upload(thread_id: str, request: Request, file: UploadFile):
        require_origin(request, settings.origin)
        data = file.file.read(_MAX_UPLOAD_BYTES + 1)
        mime = file.content_type or ""
        # C-TAMAÑO (Consultor): rechazo EXPLÍCITO del exceso (413) antes de abrir conexión/subir — nunca
        # truncar en silencio (se lee _MAX+1 precisamente para detectar el exceso).
        if len(data) > _MAX_UPLOAD_BYTES:
            raise HTTPException(413, detail={"error": "upload_too_large",
                                             "message": "La imagen supera el tamaño máximo."})
        # FASE 1 (txn CORTA): autenticar + validar conexión + resolver bucket y token PATH A. La conexión
        # (y el FOR UPDATE de users de require_user) se SUELTA al salir del with, ANTES de la subida GCS
        # lenta (REA nota operativa + interfaz: no retener el lock durante la red; ciclo de conexión acotado).
        with database.connect() as c:
            owner = require_user(c, request)
            # Candado c2 (REA, CONDICIÓN-AHORA): allowlist por-usuario de la subida; fail-closed por
            # ausencia (getattr → ()), patrón voz. El roster (quién) es decisión del dueño.
            if str(owner["id"]) not in getattr(settings, "creative_upload_pilot_user_ids", ()):
                raise HTTPException(403, detail={"error": "pilot_only",
                                                 "message": "La subida no está disponible para tu cuenta."})
            row = _connection_row(c, owner)
            bucket = clips_only_output_bucket(settings, google_project=row["project_id"])
            if not bucket:
                raise HTTPException(503, detail={"error": "upload_unavailable",
                                                 "message": "La subida no está disponible ahora."})
            owner_id = str(owner["id"])
            identity = ClipsOnlyIdentity(
                user_id=owner_id, google_subject=owner["google_subject"],
                project_id=row["project_id"])
            token = clips_only_token_provider(
                connection_loader=lambda _id: dict(row), cipher=cipher, cloud=cloud)(identity)
        # FASE 2 (subida GCS, SIN lock de DB retenido) + FASE 3 (registro en txn corta propia vía _record).
        session = requests.Session()
        try:
            ref = upload_clip_input(
                owner_id=owner_id, mime_type=mime, data=data, bucket=bucket,
                token=token, session=session,
                expected_location=getattr(settings, "creative_output_location", ""),
                asset_recorder=_record)
        except (ClipsOnlyUploadError, ClipsOnlyOwnedInputError):
            raise HTTPException(400, detail={"error": "upload_rejected",
                                             "message": "No se pudo subir la imagen."}) from None
        finally:
            close = getattr(session, "close", None)
            if callable(close):
                close()
        return {"assetId": ref.asset_id, "mimeType": ref.mime_type, "byteSize": ref.byte_size}

    return router
