"""`token_provider` PATH A para el despacho Veo — ADDITIVE, reusa la ruta viva de la voz como CONSUMIDOR.

Decisión del dueño/§7 del Consultor: el runner de vídeo se autentica como la voz — refresh del
user-OAuth del cliente → access token (scope cloud-platform) → Bearer en el POST a Veo, facturado al
proyecto del cliente, CERO credencial de servidor. Este módulo lo aporta SIN modificar ni reimplementar
la ruta viva de la voz (`uony_live_gateway` / `GoogleCloudProvider.refresh`): reusa los MISMOS primitivos
INYECTADOS, para no tocar código vivo (la voz no se puede romper) y para ser testeable sin red:
  * `connection_loader(identity)` → la fila de `google_cloud_connections` YA validada igual que la voz
    (`_connection`: identidad, status='connected', project_check.ready, scope con cloud-platform). La
    validación NO se duplica aquí: la aporta el loader inyectado (reusa la de la voz).
  * `cipher` = el MISMO `Fernet(settings.encryption_key)` de la voz → descifra `refresh_encrypted`.
  * `cloud` = el MISMO `GoogleCloudProvider` → `cloud.refresh(refresh)` da el access token.
Devuelve el Bearer; NO construye sesiones Live ni toca el navegador.

AVISO (idéntico al de la voz, uony_live_gateway.py:90-94): el token es el OAuth del USUARIO con scope
cloud-platform (amplio) — aceptable SOLO para el hito de PRUEBA (proyecto inerte). La credencial de
PRODUCCIÓN acotada a Vertex (WIF / roles/aiplatform.user, mínimo privilegio) es diseño aparte que vuelve
al Consultor (condición 3). D-PROTECCIÓN: no se registra el token ni se expone.

STAGED + INERTE: función pura sobre primitivos inyectados; sin red/DB propias; sin llamador. Lo consume
el context_loader (paso 4) como `token`. Toca Google auth → requiere APROBADO del Consultor + que
interfaz confirme que no perturba la voz viva ANTES de cablear.
"""
from __future__ import annotations

from typing import Callable

from .creative_google_dispatch_codes import TOKEN_INVALID


class ClipsOnlyTokenError(Exception):
    """Fail-closed: no se obtuvo un access token Veo verificable por la vía user-OAuth.

    F1: porta `dispatch_code=TOKEN_INVALID` para el log del worker (sin exponer el mensaje)."""

    dispatch_code = TOKEN_INVALID


def clips_only_token_provider(*, connection_loader: Callable[[object], object],
                              cipher: object, cloud: object) -> Callable[[object], str]:
    """Devuelve `provide(identity) -> str` (Bearer para el POST Veo). Reusa los primitivos de la voz
    inyectados; fail-closed ante fila/refresh/token inválidos. No reimplanta refresh ni crypto."""
    if not (callable(connection_loader) and callable(getattr(cipher, 'decrypt', None))
            and callable(getattr(cloud, 'refresh', None))):
        raise ClipsOnlyTokenError('Los primitivos inyectados (connection/cipher/cloud) no son válidos.')

    def provide(identity: object) -> str:
        row = connection_loader(identity)
        encrypted = row.get('refresh_encrypted') if isinstance(row, dict) else None
        if not isinstance(encrypted, str) or not encrypted:
            raise ClipsOnlyTokenError('La conexión del usuario no trae refresh cifrado.')
        try:
            refresh = cipher.decrypt(encrypted.encode()).decode()
        except Exception as error:
            raise ClipsOnlyTokenError('No se pudo descifrar el refresh del usuario.') from error
        if not isinstance(refresh, str) or not refresh:
            raise ClipsOnlyTokenError('El refresh descifrado no es válido.')
        token = cloud.refresh(refresh)
        # Mismo saneo que la voz (uony_live_gateway.py:82): str no vacío y sin CR/LF (anti-inyección
        # de cabeceras en el Bearer del POST).
        if (not isinstance(token, str) or not token
                or '\r' in token or '\n' in token):
            raise ClipsOnlyTokenError('El refresh no devolvió un access token Veo verificable.')
        return token

    return provide
