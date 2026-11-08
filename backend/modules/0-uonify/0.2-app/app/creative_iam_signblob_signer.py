"""Firmante IAM signBlob V4 (B2): implementación concreta de `GcsV4Signer` SIN dep nueva.

Producto decidió **B2** (27-10): firmar la URL V4 vía la IAM Service Account Credentials API
(`:signBlob`) por REST con `requests`+`google-auth` (ya en la imagen viva), SIN
`google-cloud-storage` y SIN fichero de clave (keyless, rol `serviceAccountTokenCreator`; ficha
cloud-storage §3.6/§4.3, línea 121).

Este módulo NO reimplanta la canonicalización V4: compone el canonicalizador YA aprobado
`build_v4_signed_get_url` (creative_media_signed_url, Lote A/M9) aportando el `sign` que falta —
firma el *string-to-sign* llamando a signBlob. La credencial (token Bearer) y el cliente HTTP se
INYECTAN:
  * keyless — nunca descarga ni lee una clave;
  * testeable sin red — `http_post`/`token_provider`/`now_provider` son dobles en las pruebas;
  * la credencial exacta y su scope los cablea+verifica infra/Consultor, no este módulo.

VETO Google: el endpoint y el scope exacto de signBlob los verifica el Consultor (ver
SOLICITUD ... SIGNER-B2). Staged + INERTE: sin llamador; no hace red salvo a través del
`http_post` inyectado. Fail-closed: cualquier respuesta inesperada → `IamSignBlobError`.
"""
from __future__ import annotations

from base64 import b64decode, b64encode
from datetime import datetime, timezone
from typing import Callable
from urllib.parse import quote

from .creative_media_signed_url import SignedUrlError, build_v4_signed_get_url

# IAM Service Account Credentials API (API pública): firma un blob con la clave gestionada de la
# SA, sin exponerla. El token (y por tanto el scope/credencial) lo aporta `token_provider`; aquí
# NO se fija scope ni se minta credencial.
_IAMCREDENTIALS = 'https://iamcredentials.googleapis.com'
_SIGNBLOB_PATH = '/v1/projects/-/serviceAccounts/{sa}:signBlob'

TokenProvider = Callable[[], str]
HttpPost = Callable[..., object]       # forma de requests.post(url, *, headers, json, timeout)
NowProvider = Callable[[], datetime]


class IamSignBlobError(SignedUrlError):
    """Fail-closed: la firma IAM signBlob no se completó de forma verificable."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class IamSignBlobV4Signer:
    """`GcsV4Signer` concreto (B2). Keyless: el token lo da `token_provider` inyectado.

    Cumple el Protocol `GcsV4Signer` (creative_signed_delivery): expone
    `signed_get_url(*, bucket, object_name, generation, expires_in_seconds) -> str`.
    """

    def __init__(self, *, sa_email: str, token_provider: TokenProvider,
                 http_post: HttpPost, region: str = 'auto',
                 now_provider: NowProvider = _utcnow,
                 timeout_seconds: float = 10.0) -> None:
        # `region='auto'` es el valor que usa GCS para el scope V4 (igual que el default de
        # build_v4_signed_get_url); infra puede fijar otro si el Consultor lo indica.
        if not isinstance(sa_email, str) or not sa_email:
            raise IamSignBlobError('La SA firmante no es válida.')
        if not isinstance(region, str) or not region:
            raise IamSignBlobError('La región no es válida.')
        if not (callable(token_provider) and callable(http_post)
                and callable(now_provider)):
            raise IamSignBlobError(
                'token_provider, http_post y now_provider deben ser invocables.')
        if not isinstance(timeout_seconds, (int, float)) or isinstance(timeout_seconds, bool) \
                or timeout_seconds <= 0:
            raise IamSignBlobError('timeout_seconds debe ser positivo.')
        self._sa_email = sa_email
        self._region = region
        self._token_provider = token_provider
        self._http_post = http_post
        self._now_provider = now_provider
        self._timeout = float(timeout_seconds)

    def _sign(self, message: bytes) -> bytes:
        """`sign` para build_v4: firma el string-to-sign vía signBlob y devuelve bytes crudos."""
        if not isinstance(message, (bytes, bytearray)) or not message:
            raise IamSignBlobError('No hay string-to-sign que firmar.')
        token = self._token_provider()
        if not isinstance(token, str) or not token:
            raise IamSignBlobError('El proveedor de credencial no devolvió un token.')
        url = _IAMCREDENTIALS + _SIGNBLOB_PATH.format(
            sa=quote(self._sa_email, safe='@.'))
        response = self._http_post(
            url,
            headers={'Authorization': f'Bearer {token}',
                     'Content-Type': 'application/json'},
            json={'payload': b64encode(bytes(message)).decode('ascii')},
            timeout=self._timeout)
        if getattr(response, 'status_code', None) != 200:
            raise IamSignBlobError(
                f'signBlob respondió {getattr(response, "status_code", None)!r}, no 200.')
        try:
            body = response.json()
        except Exception as error:
            raise IamSignBlobError('signBlob no devolvió JSON.') from error
        signed = body.get('signedBlob') if isinstance(body, dict) else None
        if not isinstance(signed, str) or not signed:
            raise IamSignBlobError('signBlob no devolvió signedBlob.')
        try:
            signature = b64decode(signed, validate=True)
        except Exception as error:
            raise IamSignBlobError('signedBlob no es base64 válido.') from error
        if not signature:
            raise IamSignBlobError('signBlob devolvió una firma vacía.')
        return signature

    def signed_get_url(self, *, bucket: str, object_name: str, generation: int,
                       expires_in_seconds: int) -> str:
        """Firma una GET V4 de solo-lectura FIJADA a la `generation` exacta del objeto.

        Fijar la versión cierra el TOCTOU entre adopción y firma (veredicto signer-B2 §V3): la URL
        solo sirve esa generación, no una sobrescritura posterior. `build_v4_signed_get_url` la
        añade a la query canónica (se firma) y a la URL."""
        if not isinstance(generation, int) or isinstance(generation, bool) or generation <= 0:
            raise IamSignBlobError('generation debe ser un entero positivo.')
        return build_v4_signed_get_url(
            bucket=bucket, object_name=object_name, sa_email=self._sa_email,
            expires_seconds=expires_in_seconds, sign=self._sign,
            now=self._now_provider(), region=self._region, generation=generation)
