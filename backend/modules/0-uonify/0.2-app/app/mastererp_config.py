"""Conexión de Uony con ERP · Finanzas de MasterERP DEV: configuración pública, sin secretos.

Decisión del dueño (09-11-2026, D-UONY-ERP-AGENTES-20261110): el usuario conecta su cuenta
del ERP como conecta Drive. El servidor inicia y canjea el código (code + PKCE S256, state y
nonce) contra el cliente web público de Cognito del equipo, que no tiene secreto, y llama a las
API de servidor a servidor (sin CORS). Veredicto del Consultor Google: APROBADO CON CONDICIONES
C1-C8. Todos estos valores son públicos (frontend/modules/0-uonify/auth-config.json del equipo)
y se pueden cambiar por entorno sin tocar settings.py, que en la línea CONV es distinto.
"""
import os
from dataclasses import dataclass

ENV_PREFIX = 'UONIFY_MASTERERP_'


@dataclass(frozen=True)
class MastererpConfig:
    issuer: str
    client_id: str
    hosted_ui: str
    agent_api: str
    admin_api: str
    scopes: tuple[str, ...]
    callback_path: str = '/api/auth/mastererp/callback'

    def redirect_uri(self, origin: str) -> str:
        return origin.rstrip('/') + self.callback_path

    @property
    def jwks_url(self) -> str:
        return self.issuer + '/.well-known/jwks.json'


def load_mastererp_config() -> MastererpConfig:
    env = lambda name, default: os.environ.get(ENV_PREFIX + name, default).rstrip('/')
    return MastererpConfig(
        issuer=env('ISSUER', 'https://cognito-idp.us-west-1.amazonaws.com/us-west-1_oCn3VipDO'),
        client_id=env('CLIENT_ID', '56psiha6rtmsu8qklace85k8m0'),
        hosted_ui=env('HOSTED_UI', 'https://mastererp-dev-uonify-277352717693.auth.us-west-1.amazoncognito.com'),
        agent_api=env('AGENT_API', 'https://ebn01q74hh.execute-api.us-west-1.amazonaws.com'),
        admin_api=env('ADMIN_API', 'https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com'),
        scopes=('openid', 'email', 'mastererp-dev/identity.spaces.read'),
    )
