"""Configuración local: los secretos se leen en el servidor y nunca se devuelven."""
from dataclasses import dataclass
from pathlib import Path
import json
import os
from urllib.parse import urlsplit
from uuid import UUID
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .uony_semantic_model import SemanticModelPilot


@dataclass(frozen=True, repr=False)
class Settings:
    origin: str
    database: dict
    encryption_key: bytes
    google_client_id: str = ''
    google_client_secret: str = ''
    secrets_directory: str = '/run/uonify'
    session_seconds: int = 7 * 24 * 60 * 60
    # Kept off until provider parity and an approved chat presentation are verified.
    streaming_enabled: bool = False
    # Staged ADK coordinator. A job keeps its chosen engine even after restart.
    adk_enabled: bool = False
    # A separate local pilot file permits only these account IDs to select ADK.
    # The full enablement above remains a test-only injection, never an env flag.
    adk_pilot_user_ids: tuple[str, ...] = ()
    # Materials pilot is account-scoped and inert without an ADK analyzer.
    # Its separate local allowlist never enables the conversation ADK pilot.
    material_adk_pilot_user_ids: tuple[str, ...] = ()
    # Local Live bridge pilot: no environment switch and no provider by default.
    live_pilot_user_ids: tuple[str, ...] = ()
    # A real Live pilot file must explicitly cap paid admissions per account.
    # The count survives chat erasure and API restarts in a separate ledger.
    live_pilot_session_limit: int | None = None
    # ADK-FLUJOS §11: explicit server-side route per Live pilot account. Listed
    # accounts converse through ADK Runner.run_live; the rest keep the raw route.
    live_adk_user_ids: tuple[str, ...] = ()
    # PIEZA 1 de la voz: cuentas que conversan por el gateway nuevo (client.aio.live.connect).
    # Subconjunto del piloto Live; vacío = nadie usa el gateway (sigue el raw/ADK).
    live_gateway_user_ids: tuple[str, ...] = ()
    # Conservative local admission guard, not a measured production capacity.
    conversation_active_limit: int = 256
    # Opt-in QA budget; requires both an ADK pilot account and workspace project.
    test_daily_request_limit: int = 50
    test_project_ids: tuple[str, ...] = ()
    # Fixed semantic-only qualification; no file means no routing override.
    semantic_model_pilot: 'SemanticModelPilot | None' = None
    # Plan B (lote 6, «Consultor google»): a second semantic opinion before a
    # written read. Off unless UONIFY_READ_INTENT_CHECK=1.
    read_intent_check: bool = False
    # §6 release creativo: allowlist de buckets de SALIDA durable de Veo (y la MISMA que
    # usa el cableado craft de ArtCraft para H15 §3). De config del servidor, nunca del
    # request. Vacía por defecto → el gate falla cerrado hasta que el release la fije.
    creative_output_buckets: tuple[str, ...] = ()
    # §6/H15 §3 (Opción A, aprobada por el Consultor): región donde se autoriza la SALIDA
    # durable. La adopción craft (rewrite GCS) la compara contra metadata.location del
    # bucket; NO es un endpoint Vertex, así que NUNCA 'global'. Verbatim (sin forzar
    # mayúsculas): una región equivocada debe fallar cerrado contra la metadata del bucket,
    # no corregirse en silencio. '' por defecto → fail-closed hasta que el release la fije.
    creative_output_location: str = ''
    # Allowlists de rollout del motor creativo (clips-only): claim (coordinator:564) + dispatch
    # (coordinator:729), leídas vía getattr(settings, …, ()). Vacías por defecto → el coordinador
    # permanece DESACTIVADO por ausencia (fail-closed); se pueblan en el go-live con el id del dueño.
    creative_execution_pilot_user_ids: tuple[str, ...] = ()
    creative_provider_dispatch_pilot_user_ids: tuple[str, ...] = ()
    # Candado c2 (REA): allowlist por-usuario de la ruta de subida clips-only; fail-closed por ausencia.
    creative_upload_pilot_user_ids: tuple[str, ...] = ()
    # Puerto de los RATE SNAPSHOTS del clip (config de OPERADOR, veredicto Consultor 28-10 ORIGEN-RATE-
    # SNAPSHOTS + PRICING-WIRING). Dict con la forma que parsea `clips_only_operator_rate_snapshots`
    # (checkedAt/expiresAt + generation + infrastructure). NUNCA del cliente ni del modelo. Por defecto
    # None → el puerto devuelve (None,None) → readiness incompleta → «sin precio» → 0 persistencia → 0 gasto
    # (C-MOUNT-2: la ruta quote puede ir montada mientras ESTO siga None hasta la re-x-ray VIVA). Lo puebla
    # el operador, en el go-live, con el snapshot fresco (≤24 h) BENDECIDO por el dueño; poblarlo = paso
    # go-live → vuelve a Consultor+REA. La frescura/completitud la valida `_validate_rates`/infra aguas abajo.
    creative_clips_only_rate_snapshots: dict | None = None
    # Login simple de admin (correo+contraseña) SOLO local/desarrollo, detrás de flag; por defecto 2FA (prod).
    admin_dev_simple_login: bool = False

    @property
    def callback(self):
        return self.origin + '/api/auth/google/callback'

    @property
    def return_url(self):
        return self.origin + '/?auth=return'

    @property
    def google_ready(self):
        return bool(self.google_client_id and self.google_client_secret)


def load_settings():
    directory = Path(os.environ.get('UONIFY_SECRETS_DIR', '/run/uonify'))
    client = json.loads((directory / 'google-oauth.json').read_text()).get('web', {})
    origin = os.environ.get('UONIFY_ORIGIN', 'http://127.0.0.1:5173').rstrip('/')
    # Orígenes permitidos de forma explícita: el local y DEV (D-DEV-HOSTING-20261107).
    # Producción necesita otra configuración.
    if origin not in ('http://127.0.0.1:5173', 'https://dev.uonify.com'):
        raise RuntimeError('Origen no permitido')
    try:
        active_limit = int(os.environ.get('UONIFY_CONVERSATION_ACTIVE_LIMIT', '256'))
    except ValueError as exc:
        raise RuntimeError('UONIFY_CONVERSATION_ACTIVE_LIMIT debe ser un entero positivo') from exc
    if active_limit < 1:
        raise RuntimeError('UONIFY_CONVERSATION_ACTIVE_LIMIT debe ser un entero positivo')
    try:
        test_limit = int(os.environ.get('UONIFY_TEST_DAILY_REQUEST_LIMIT', '50'))
        if not 50 <= test_limit <= 200:
            raise ValueError('out of range')
        project_text = os.environ.get('UONIFY_TEST_PROJECT_IDS', '').strip()
        test_projects = tuple(str(UUID(value.strip())) for value in project_text.split(',')) if project_text else ()
        if len(test_projects) != len(set(test_projects)):
            raise ValueError('duplicate projects')
    except (ValueError, TypeError) as exc:
        raise RuntimeError('El presupuesto de prueba necesita un límite entre 50 y 200 y proyectos UUID únicos.') from exc
    def pilot_users(name, *, live=False):
        pilot_file = directory / name
        if not pilot_file.exists():
            return ((), None) if live else ()
        try:
            if pilot_file.stat().st_size > 4096:
                raise ValueError('pilot configuration too large')
            data = json.loads(pilot_file.read_text())
            users = data['userIds']
            expected = {'userIds', 'sessionLimit'} if live else {'userIds'}
            if not isinstance(data, dict) or set(data) != expected or not isinstance(users, list):
                raise ValueError('invalid pilot configuration')
            pilot_user_ids = tuple(str(UUID(value)) for value in users
                                   if isinstance(value, str))
            if len(pilot_user_ids) != len(users) or len(set(pilot_user_ids)) != len(users):
                raise ValueError('invalid pilot users')
            if live:
                limit = data['sessionLimit']
                # Tope de gasto aprobado por el dueño (20-10-2026): hasta 200 sesiones.
                if type(limit) is not int or not 1 <= limit <= 200:
                    raise ValueError('invalid Live pilot session limit')
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            raise RuntimeError(f'La lista local del piloto {name} no es válida') from exc
        return (pilot_user_ids, limit) if live else pilot_user_ids
    def rate_snapshots(name):
        # Puerto de tarifas del clip: lee SOLO un fichero local de OPERADOR del directorio de secretos
        # (server-side; jamás del cliente/modelo). AUSENTE → None (fail-closed → «sin precio» → 0 gasto;
        # C-MOUNT-2). A diferencia de `pilot_users`, un fichero malformado NO levanta (no tumba el API por
        # una tarifa): degrada a None y el sistema queda «sin precio» (la vía defensiva aprobada). La forma,
        # frescura (≤24 h) y completitud las valida `clips_only_operator_rate_snapshots` + `_validate_rates`
        # /infra aguas abajo; aquí solo se entrega el dict crudo (o None) para que el puerto lo valide.
        snapshot_file = directory / name
        if not snapshot_file.exists():
            return None
        try:
            if snapshot_file.stat().st_size > 64 * 1024:
                return None
            data = json.loads(snapshot_file.read_text())
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        return data if isinstance(data, dict) else None
    pilot_user_ids = pilot_users('adk-pilot-users.json')
    material_pilot_user_ids = pilot_users('material-adk-pilot-users.json')
    live_pilot_user_ids, live_pilot_session_limit = pilot_users('live-pilot-users.json', live=True)
    live_adk_user_ids = tuple(user for user in pilot_users('live-adk-users.json')
                              if user in live_pilot_user_ids)
    live_gateway_user_ids = tuple(user for user in pilot_users('live-gateway-users.json')
                                  if user in live_pilot_user_ids)
    creative_execution_pilot_user_ids = pilot_users('creative-execution-pilot-users.json')
    creative_provider_dispatch_pilot_user_ids = pilot_users('creative-provider-dispatch-pilot-users.json')
    creative_upload_pilot_user_ids = pilot_users('creative-upload-pilot-users.json')
    creative_clips_only_rate_snapshots = rate_snapshots('creative-clips-only-rate-snapshots.json')
    from .uony_semantic_model import load_semantic_model_pilot
    semantic_pilot = load_semantic_model_pilot(directory, pilot_user_ids, test_projects)
    return Settings(
        origin=origin,
        secrets_directory=str(directory),
        database={'host': os.environ.get('PGHOST', 'db'), 'dbname': 'uonify',
                  'user': 'uonify', 'password': (directory / 'postgres-password').read_text().strip()},
        encryption_key=(directory / 'encryption-key').read_bytes().strip(),
        google_client_id=client.get('client_id', ''),
        google_client_secret=client.get('client_secret', ''),
        conversation_active_limit=active_limit,
        test_daily_request_limit=test_limit,
        test_project_ids=test_projects,
        adk_pilot_user_ids=pilot_user_ids,
        material_adk_pilot_user_ids=material_pilot_user_ids,
        live_pilot_user_ids=live_pilot_user_ids,
        live_pilot_session_limit=live_pilot_session_limit,
        live_adk_user_ids=live_adk_user_ids,
        live_gateway_user_ids=live_gateway_user_ids,
        semantic_model_pilot=semantic_pilot,
        read_intent_check=os.environ.get('UONIFY_READ_INTENT_CHECK', '') == '1',
        creative_output_buckets=tuple(
            value.strip() for value
            in os.environ.get('UONIFY_CREATIVE_OUTPUT_BUCKETS', '').split(',')
            if value.strip()),
        creative_output_location=os.environ.get(
            'UONIFY_CREATIVE_OUTPUT_LOCATION', '').strip(),
        creative_execution_pilot_user_ids=creative_execution_pilot_user_ids,
        creative_provider_dispatch_pilot_user_ids=creative_provider_dispatch_pilot_user_ids,
        creative_upload_pilot_user_ids=creative_upload_pilot_user_ids,
        creative_clips_only_rate_snapshots=creative_clips_only_rate_snapshots,
        admin_dev_simple_login=(os.environ.get('UONIFY_ADMIN_DEV_SIMPLE_LOGIN', '') == '1'
                                and urlsplit(origin).scheme == 'http'
                                and urlsplit(origin).hostname in ('127.0.0.1', 'localhost', '::1')),
    )
