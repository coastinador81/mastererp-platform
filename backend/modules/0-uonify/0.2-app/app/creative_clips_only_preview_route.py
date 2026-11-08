"""Endpoint ON-VIEW del preview del clip (rama c, entrega LAZY a Drive).

Mismo patrón que creative_clips_only_upload_route (REA/Consultor): require_origin (CSRF) + require_user
(dueño de SESIÓN, nunca del cuerpo) + lock-lifetime acotado (sin lock de DB durante la red).

La PRIMERA vez que el cliente abre el preview de su clip, este endpoint lo entrega a SU Google Drive
(idempotente, create-only + 409-idempotente + write-once del store/142) y devuelve SOLO el fileId
(puntero de preview nativo, card-safe). Llamadas posteriores devuelven el mismo fileId sin re-entregar.

DOS conexiones Google SEPARADAS (verificado): `google_cloud_connections` (scope cloud-platform, PATH A,
lee el output de GCS) y `google_drive_connections` (scope drive.file, sube el clip). Dos refresh tokens
distintos → dos access tokens distintos (cloud_token / drive_token), que es exactamente lo que el núcleo
`deliver_clip_to_drive` toma como 2 params separados.

CARD-SAFE (D-PROTECCIÓN): la respuesta expone SOLO `fileId`; nunca sha256, bucket, generation ni gs://.

STAGED + INERTE: `routes()` NO se monta (sin include_router en main.py) hasta OK Consultor + REA + dueño;
la activación (montaje de la ruta + flip) es el paso de go-live.
"""
from __future__ import annotations

import re

import requests
from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException, Request

from .creative_clips_only_drive_delivery import (ClipsOnlyDriveDeliveryError,
                                                 deliver_clip_to_drive)
from .creative_clips_only_drive_delivery_store import (
    ClipsOnlyDriveDeliveryStoreError, clips_only_get_delivery,
    clips_only_record_delivery, clips_only_reserve_delivery,
    clips_only_resolve_adopted_clip)
from .creative_clips_only_live_provider import ClipsOnlyIdentity
from .creative_clips_only_token_provider import clips_only_token_provider
from .google_cloud_provider import SCOPE
from .onboarding import require_user
from .security import require_origin

_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"


def _clip_name(job_id: str) -> str:
    """Nombre de archivo simple y card-safe para el clip en el Drive del cliente. El nombre VISIBLE es
    decisión UX del dueño/Frontend-app; aquí solo un nombre simple garantizado (lo valida _safe_name del
    núcleo). Se sanea el job_id (UUID) para no arrastrar caracteres no admitidos."""
    safe = re.sub(r"[^A-Za-z0-9_-]", "", str(job_id))[:40]
    return f"uony-clip-{safe or 'estudio'}.mp4"


def routes(settings, database, cloud, drive):
    router = APIRouter(prefix="/api/uony/estudio")
    cipher = Fernet(settings.encryption_key)

    def _cloud_row(c, owner):
        """Conexión Cloud del cliente (google_cloud_connections) validada: identidad + connected + proyecto
        listo + scope cloud-platform. Sin ella no hay lectura PATH A del output ⇒ 403 (reconectar)."""
        row = c.execute(
            """SELECT google_subject,project_id,status,project_check,refresh_encrypted,scope
               FROM google_cloud_connections WHERE user_id=%s""",
            (owner["id"],)).fetchone()
        checks = row.get("project_check") if row else None
        if (not row or row["google_subject"] != owner.get("google_subject")
                or row["status"] != "connected" or not isinstance(checks, dict)
                or checks.get("ready") is not True
                or SCOPE not in (row.get("scope") or "").split()):
            raise HTTPException(409, detail={
                "error": "cloud_not_ready",
                "message": "Reconecta tu Google Cloud para ver tu clip."})
        return row

    def _drive_row(c, owner):
        """Conexión Drive del cliente (google_drive_connections) validada: identidad + connected + scope
        drive.file (ESCRITURA). Sin ella no se puede subir el clip ⇒ 403 (reconectar concediendo Drive)."""
        row = c.execute(
            """SELECT google_subject,status,refresh_encrypted,scope
               FROM google_drive_connections WHERE user_id=%s""",
            (owner["id"],)).fetchone()
        if (not row or row["google_subject"] != owner.get("google_subject")
                or row["status"] != "connected"
                or _DRIVE_FILE_SCOPE not in (row.get("scope") or "").split()):
            raise HTTPException(409, detail={
                "error": "drive_not_ready",
                "message": "Reconecta tu Google Drive concediendo guardar archivos para ver tu clip."})
        return row

    @router.post("/clips/{job_id}/preview")
    def preview(job_id: str, request: Request):
        require_origin(request, settings.origin)
        # FASE A (txn CORTA): autenticar + corto-circuito idempotente + validar las 2 conexiones + acuñar
        # los 2 tokens + resolver el clip adoptado. El lock (FOR UPDATE de users de require_user, FOR SHARE
        # de las lecturas) se SUELTA al salir del with, ANTES de la red (reserve_id/download/upload).
        with database.connect() as c:
            owner = require_user(c, request)
            owner_id = str(owner["id"])
            state = clips_only_get_delivery(c, user_id=owner_id, job_id=job_id)
            if state and state.delivered_file_id:
                return {"fileId": state.delivered_file_id}  # ya entregado: idempotente, card-safe
            cloud_row = _cloud_row(c, owner)
            drive_row = _drive_row(c, owner)
            # INVARIANTE inv-013 (single-google-account), ANTES de usar ningún token: las DOS conexiones
            # (Cloud + Drive) deben ser la MISMA cuenta Google (mismo google_subject). Así el clip va SIEMPRE
            # al Drive del PROPIO dueño, nunca a otra cuenta. _cloud_row/_drive_row ya validan cada una contra
            # el google_subject de la sesión; este cross-check explícito es fail-closed de defensa en profundidad.
            if (not cloud_row["google_subject"]
                    or cloud_row["google_subject"] != drive_row["google_subject"]):
                raise HTTPException(403, detail={
                    "error": "account_mismatch",
                    "message": "Tu Google Cloud y tu Google Drive deben ser la misma cuenta de Google."})
            try:
                adopted = clips_only_resolve_adopted_clip(c, user_id=owner_id, job_id=job_id)
            except ClipsOnlyDriveDeliveryStoreError:
                raise HTTPException(404, detail={
                    "error": "clip_not_ready",
                    "message": "Tu clip aún no está listo."}) from None
            identity = ClipsOnlyIdentity(
                user_id=owner_id, google_subject=owner["google_subject"],
                project_id=cloud_row["project_id"])
            cloud_token = clips_only_token_provider(
                connection_loader=lambda _id: dict(cloud_row), cipher=cipher, cloud=cloud)(identity)
            drive_token = drive.refresh(
                cipher.decrypt(drive_row["refresh_encrypted"].encode()).decode())
            # C-PREV-1 (Consultor+REA): simetría del guard anti-CRLF (invariante REA) sobre el drive_token,
            # local al camino clips-only. El cloud_token ya lo aplica clips_only_token_provider; el drive_token
            # se acuña directo con drive.refresh, así que aquí aplicamos el MISMO guard: str no vacío, sin \r/\n.
            if (not isinstance(drive_token, str) or not drive_token
                    or '\r' in drive_token or '\n' in drive_token):
                raise HTTPException(502, detail={
                    "error": "preview_unavailable",
                    "message": "No se pudo preparar tu clip ahora."})
            reserved = state.reserved_file_id if state else None

        # FASE B (SIN lock): reservar el id de Drive si aún no había reserva.
        if reserved is None:
            reserved = drive.reserve_id(drive_token)
            # FASE C (txn CORTA): persistir la reserva (create-only; ON CONFLICT devuelve el ganador).
            with database.connect() as c:
                rstate = clips_only_reserve_delivery(
                    c, user_id=owner_id, job_id=job_id, asset_id=adopted.asset_id,
                    reserved_file_id=reserved)
            if rstate.delivered_file_id:
                return {"fileId": rstate.delivered_file_id}  # otra entrega ganó la carrera
            reserved = rstate.reserved_file_id  # el id EFECTIVO (el que ganó el ON CONFLICT)

        # FASE D (SIN lock): leer el clip adoptado de GCS (cloud_token) + subir a Drive (drive_token)
        # reusando el id reservado. El núcleo es fail-closed y verifica byte_size+sha256 == el adoptado.
        session = requests.Session()
        try:
            receipt = deliver_clip_to_drive(
                receipt=adopted.receipt, name=_clip_name(job_id),
                reserved_file_id=reserved, cloud_token=cloud_token,
                drive_token=drive_token, provider=drive, session=session)
        except ClipsOnlyDriveDeliveryError:
            raise HTTPException(502, detail={
                "error": "preview_unavailable",
                "message": "No se pudo preparar tu clip ahora."}) from None
        finally:
            close = getattr(session, "close", None)
            if callable(close):
                close()

        # FASE E (txn CORTA): marcar entregado (write-once idempotente del store/142).
        with database.connect() as c:
            clips_only_record_delivery(
                c, user_id=owner_id, job_id=job_id, file_id=receipt.file_id,
                sha256=adopted.receipt.sha256)
        return {"fileId": receipt.file_id}  # card-safe: SOLO el fileId (nunca sha256/bucket/gs://)

    return router
