"""URL firmada V4 de GCS (GET de lectura) vía IAM signBlob (Lote A, M9).

Para medios que RESIDAN en GCS (p. ej. previsualizar la salida de generación us-central1 antes del
montaje). La ENTREGA del final va por Drive (M6), no por aquí. El cliente descarga DIRECTO del bucket
(egress al dueño del bucket = el cliente), sin pasar por AWS.

El FIRMANTE se INYECTA: `sign(message: bytes) -> bytes` firma el string-to-sign con la clave de la SA
vía IAM signBlob (rol `serviceAccountTokenCreator`), SIN fichero de clave local (condición del
Consultor; en local, proyecto de pruebas; en lanzamiento, la SA federada). Este módulo construye el
canonical request + string-to-sign V4 y ensambla la URL; puro salvo el firmante. Fail-closed.

Card-safe: la URL es https (mecanismo de acceso que aprobó el Consultor); nunca se expone `gs://` ni
el project-id. El `now` se inyecta para firmar de forma determinista/testeable."""
from __future__ import annotations

import re
from datetime import datetime
from hashlib import sha256
from typing import Callable
from urllib.parse import quote

_HOST = "storage.googleapis.com"
_ALGO = "GOOG4-RSA-SHA256"
_MAX_EXPIRES = 7 * 24 * 60 * 60  # V4: máximo 7 días.
_BUCKET = re.compile(r"[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]\Z")
_SA_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com\Z")

SignFn = Callable[[bytes], bytes]


class SignedUrlError(Exception):
    """Fail-closed: no se pudo construir una URL firmada V4 válida."""


def _canonical_object(object_name: str) -> str:
    # Codifica cada segmento; conserva '/' como separador.
    return "/".join(quote(seg, safe="") for seg in object_name.split("/"))


def build_v4_signed_get_url(
        *, bucket: str, object_name: str, sa_email: str, expires_seconds: int,
        sign: SignFn, now: datetime, region: str = "auto",
        generation: int | None = None) -> str:
    """URL firmada V4 (GET) para `gs://bucket/object_name`, firmada por `sign` (IAM signBlob).

    `now` es UTC (lo inyecta el llamador). `generation` (opcional) fija la versión EXACTA del
    objeto: se añade a la query canónica (se firma) y a la URL, cerrando el TOCTOU entre adopción
    y firma (defensa en profundidad; veredicto signer-B2 §V3). `None` = comportamiento histórico
    sin fijar versión (retrocompatible). Fail-closed: valida entradas y el tipo de la firma."""
    if not callable(sign):
        raise SignedUrlError("El firmante (signBlob) debe ser invocable.")
    if not isinstance(bucket, str) or not _BUCKET.fullmatch(bucket) or ".." in bucket:
        raise SignedUrlError("El bucket no es válido.")
    if (not isinstance(object_name, str) or not object_name
            or object_name.startswith("/") or ".." in object_name.split("/")):
        raise SignedUrlError("El objeto no es una ruta válida dentro del bucket.")
    if not isinstance(sa_email, str) or not _SA_EMAIL.fullmatch(sa_email):
        raise SignedUrlError("El email de la SA firmante no es válido.")
    if type(expires_seconds) is not int or not 1 <= expires_seconds <= _MAX_EXPIRES:
        raise SignedUrlError("expires_seconds fuera de rango (1..7 días).")
    if not isinstance(now, datetime):
        raise SignedUrlError("now debe ser un datetime UTC.")
    if not isinstance(region, str) or not region:
        raise SignedUrlError("region no es válida.")
    if generation is not None and (type(generation) is not int or generation <= 0):
        raise SignedUrlError("generation debe ser un entero positivo o None.")

    x_goog_date = now.strftime("%Y%m%dT%H%M%SZ")
    date = now.strftime("%Y%m%d")
    scope = f"{date}/{region}/storage/goog4_request"
    credential = quote(f"{sa_email}/{scope}", safe="")

    query_pairs = [
        ("X-Goog-Algorithm", _ALGO),
        ("X-Goog-Credential", credential),
        ("X-Goog-Date", x_goog_date),
        ("X-Goog-Expires", str(expires_seconds)),
        ("X-Goog-SignedHeaders", "host"),
    ]
    if generation is not None:
        # `generation` son dígitos (nada que codificar); entra en la query canónica (se firma) y
        # por tanto en la URL. Ordena tras los X-Goog-* ('X' < 'g'); mismo string firmado y servido.
        query_pairs.append(("generation", str(generation)))
    canonical_query = "&".join(f"{key}={value}" for key, value in sorted(query_pairs))
    canonical_object = _canonical_object(object_name)
    canonical_uri = f"/{bucket}/{canonical_object}"
    canonical_request = (
        "GET\n"
        f"{canonical_uri}\n"
        f"{canonical_query}\n"
        f"host:{_HOST}\n\n"
        "host\n"
        "UNSIGNED-PAYLOAD")
    string_to_sign = (
        f"{_ALGO}\n{x_goog_date}\n{scope}\n"
        f"{sha256(canonical_request.encode('utf-8')).hexdigest()}")

    signature = sign(string_to_sign.encode("utf-8"))
    if not isinstance(signature, (bytes, bytearray)) or not signature:
        raise SignedUrlError("El firmante no devolvió una firma en bytes.")

    return (f"https://{_HOST}/{bucket}/{canonical_object}"
            f"?{canonical_query}&X-Goog-Signature={bytes(signature).hex()}")
