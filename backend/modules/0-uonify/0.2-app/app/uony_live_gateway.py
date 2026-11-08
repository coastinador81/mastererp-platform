"""Uony Live gateway (PIEZA 1): proveedor del transporte único (contrato LiveProvider).

Correcto por construcción sobre el SDK público google-genai (`client.aio.live.connect`),
servidor-a-servidor, SIN Drive (diseño 20261023-DISENO-PIEZA1-VOZ-GATEWAY). Abre y gobierna
la sesión Live (máquina de estados en `uony_live_gateway_session.py`). El camino viejo queda
CONGELADO como rollback (raw `uony_live_vertex.py`, tap ADK `uony_live_adk_session.py`): no se
reutiliza ni se modifica. Condiciones del Consultor 26-10
(20261026-VEREDICTO-VOZ-PLAN-PIEZA1-Y-RUIDO): credencial inyectada (nunca al navegador; la de
PRODUCCIÓN acotada a Vertex vía WIF/aiplatform.user vuelve al Consultor), guarda aiohttp,
logs sin contenido, es-US (único español en Cloud; el acento/voz lo decide el dueño).
"""
import asyncio
import logging
import re
from contextlib import suppress

from cryptography.fernet import Fernet
from google import genai
from google.genai import _api_client as _genai_api_client
from google.oauth2.credentials import Credentials

from .access import workspace_access
from .google_cloud_provider import CloudError, SCOPE
from .uony_live_bridge import LiveIdentity
from .uony_live_gateway_session import (ATAJO_INSTRUCTION, ResumptionPolicy,
                                        TRANSPORT_INSTRUCTION, UonyLiveGatewaySession)

SUPPORTED_MODELS = {'gemini-3.8-live': frozenset({'eu', 'us', 'us-central1'})}
PROJECT_ID = re.compile(r'[a-z][a-z0-9-]{4,62}[a-z0-9]')
logger = logging.getLogger(__name__)


class UonyLiveGateway:
    """Proveedor Live (contrato LiveProvider) sobre el SDK público. Opt-in; refresco y las
    dos comprobaciones de identidad quedan en el servidor. DV3 parametrizado por `policy`."""

    def __init__(self, settings, database, cloud, *, model='gemini-3.8-live', location='eu',
                 policy=ResumptionPolicy.TRANSPARENT, voice_name=None, instruction=None,
                 persist=False, agentic=False):
        if location not in SUPPORTED_MODELS.get(model, ()):
            raise ValueError('unsupported Live model/location')
        if getattr(_genai_api_client, 'has_aiohttp', False):
            # Guarda J: con aiohttp el SDK mete un reintento oculto que falsea la cuenta.
            raise RuntimeError('aiohttp present: hidden SDK retries would falsify Live accounting')
        self.settings = settings
        self.database = database
        self.cloud = cloud
        self.model = model
        self.location = location
        self.policy = policy
        self.voice_name = voice_name            # decisión de marca del dueño (D-UX).
        self.instruction = instruction or TRANSPORT_INSTRUCTION
        self.persist = persist                  # L1 guardado-Drive: persistir el transcript (inerte si False).
        self.agentic = agentic                  # PIEZA 3: voz agéntica (feed de autorización); inerte si False.
        self.cipher = Fernet(settings.encryption_key)

    def _connection(self, identity):
        if not PROJECT_ID.fullmatch(identity.project_id):
            raise ValueError('invalid Cloud project')
        with self.database.connect() as c:
            user = c.execute('''SELECT id,email,google_subject,onboarding_completed_at
                FROM users WHERE id=%s''', (identity.user_id,)).fetchone()
            row = c.execute('''SELECT google_subject,project_id,status,project_check,
                refresh_encrypted,scope,connected_at FROM google_cloud_connections
                WHERE user_id=%s''', (identity.user_id,)).fetchone()
            if (not user or user['google_subject'] != identity.google_subject
                    or not user['onboarding_completed_at']
                    or workspace_access(c, user)['status'] != 'allowed'
                    or not row or row['google_subject'] != identity.google_subject
                    or row['project_id'] != identity.project_id
                    or row['status'] != 'connected'
                    or not (row['project_check'] or {}).get('ready')
                    or SCOPE not in (row['scope'] or '').split()):
                raise ValueError('Live Cloud identity unavailable')
            return row

    async def open(self, identity: LiveIdentity):
        stage = 'local_identity'
        session = None
        try:
            row = self._connection(identity)
            refresh = self.cipher.decrypt(row['refresh_encrypted'].encode()).decode()
            stage = 'oauth_refresh'
            token = await asyncio.to_thread(self.cloud.refresh, refresh)
            if not isinstance(token, str) or not token or '\r' in token or '\n' in token:
                raise ValueError('invalid Live access token')
            stage = 'identity_recheck'
            current = self._connection(identity)
            if any(current[key] != row[key] for key in
                   ('google_subject', 'project_id', 'connected_at', 'refresh_encrypted')):
                raise ValueError('Live Cloud connection changed')
            stage = 'client'
            # Credencial inyectada en servidor; NUNCA al navegador (Vertex no da tokens
            # efímeros). Hoy es el token OAuth del usuario con scope cloud-platform (amplio):
            # aceptable SOLO para el hito de PRUEBA (proyecto inerte). NO DESPLEGAR A PRODUCCIÓN
            # sin acotar la credencial a Vertex (WIF / roles/aiplatform.user, mínimo privilegio):
            # ese diseño vuelve al Consultor (condición 3, veredicto de código 26-10).
            client = genai.Client(vertexai=True, project=identity.project_id,
                                  location=self.location, credentials=Credentials(token=token))
            model = (f'projects/{identity.project_id}/locations/{self.location}'
                     f'/publishers/google/models/{self.model}')
            stage = 'setup'
            # PIEZA 3 (atajo): agentic POR-IDENTIDAD, REUSANDO la lista de PIEZA 1 (live_gateway_user_ids;
            # decisión del dueño 27-10: sin lista nueva). Las cuentas del gateway reciben agentic=True + la
            # instrucción del atajo (ATAJO_INSTRUCTION, sellada por QA); los no-listados, la sesión NO agéntica.
            # identity.user_id = str(user['id']) = UUID canónico, igual que live_pilot_user_ids (uony_live_routes.py:79).
            agentic = self.agentic or identity.user_id in self.settings.live_gateway_user_ids
            # C5: persistir la conversación de voz en el hilo (uony_live_turns, que /threads mezcla con el texto)
            # para las cuentas del gateway (= el dueño); mismo gate que agentic.
            persist = self.persist or identity.user_id in self.settings.live_gateway_user_ids
            instruction = ATAJO_INSTRUCTION if agentic else self.instruction
            session = UonyLiveGatewaySession(client, model=model, instruction=instruction,
                                             voice_name=self.voice_name, policy=self.policy,
                                             persist=persist, agentic=agentic)
            session.start()
            await asyncio.wait_for(session._ready.wait(), timeout=10)
            if session._error is not None:
                raise ValueError('Live gateway setup not confirmed')
            return session
        except asyncio.CancelledError:
            logger.warning('Live gateway cancelled stage=%s class=CancelledError', stage)
            if session is not None:
                with suppress(Exception):
                    await session.close()
            raise
        except Exception as error:
            # No registrar el mensaje de la excepción: puede llevar rutas, project id o auth.
            status = getattr(getattr(error, 'response', None), 'status_code', None)
            if type(status) is not int or not 100 <= status <= 599:
                status = 'none'
            if isinstance(error, CloudError):
                # Solo el .code (vocabulario fijo: reauthorize/permission_denied/...); nunca el mensaje (cond. K).
                logger.warning('Live gateway open failed stage=%s class=%s http_status=%s cloud_code=%s',
                               stage, type(error).__name__, status, getattr(error, 'code', None))
            else:
                logger.warning('Live gateway open failed stage=%s class=%s http_status=%s',
                               stage, type(error).__name__, status)
            if session is not None:
                with suppress(Exception):
                    await session.close()
            raise
