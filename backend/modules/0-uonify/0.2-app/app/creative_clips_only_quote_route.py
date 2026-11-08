"""Ruta de COTIZACIÓN/AUTORIZACIÓN del clip simple (clips-only, motor 090) — MONTADA, inerte de GASTO.

Dos fronteras de petición (admission.py:13-17: emitir → el cliente revisa → el cliente autoriza):
  * `POST /api/uony/threads/{thread_id}/creative-clips/quote`: compone la cotización (composer) y, SOLO si
    la readiness es COMPLETA (hay techos de coste), la persiste (issue_clips_only_quote). Devuelve un
    `estudioCard` kind='plan' card-safe. Sin rate snapshots verificados ⇒ readiness INCOMPLETA ⇒ `maxEur=null`
    («sin precio», estado defensivo APROBADO en la maqueta) y NO se persiste (sin quoteId, «Crear» deshabilitado).
  * `POST .../creative-clips/quotes/{quote_id}/authorize` (body VACÍO): recarga la cotización por quote_id del
    path (deriva el resto server-side), autoriza (gate seam = el POST autenticado del cliente), RETIENE el grafo
    (crea el job 090) y lo ADMITE (raíces queued). Devuelve {jobId, requestSha256} para la confirmación de gasto.

SEGURIDAD (como la confirmación, ya verde): `require_user` saca el usuario de la SESIÓN (nunca del cuerpo);
`require_origin` cierra CSRF; `StrictBody` rechaza campos extra. El gasto NO ocurre aquí: authorize CREA el job
con `dispatch_authorized=false`; el despacho real lo cierran, aguas abajo, la confirmación client_explicit
(gate_decider) + el flag maestro + el WIF. D-PROTECCIÓN: la card no expone USD/gs:///model-id/project/hashes.

MONTADA, INERTE DE GASTO: `routes(...)` SÍ se incluye en main.create_app (main:107, incondicional ≥29e);
«inerte» = sin gasto (flag maestro False + confirmación client_explicit + WIF), NUNCA «no montada».
"""
from datetime import datetime, timedelta, timezone
from decimal import ROUND_CEILING, Decimal
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field

from .creative_clips_only_admission import (ClipsOnlyAuthorizationError,
                                            admit_clips_only_job,
                                            authorize_clips_only_quote,
                                            hold_clips_only_graph)
from .creative_clips_only_binding import ClipsOnlyBindingError
from .creative_clips_only_direction import compile_clips_only_animation_batch
from .creative_clips_only_draft import ClipsOnlyDraftError
from .creative_clips_only_frame_resolver import ClipsOnlyFrameResolverError
from .creative_clips_only_input_gate import (ClipsOnlyInputGateError,
                                             issue_clips_only_quote)
from .creative_clips_only_plan_bootstrap import (ClipsOnlyCloudNotReadyError,
                                                 ClipsOnlyPlanBootstrapError,
                                                 clips_only_ensure_plan_anchor,
                                                 is_estudio_clip_thread)
from .creative_clips_only_quote_orchestration import (ClipsOnlyPlanAnchorError,
                                                      clips_only_build_quote_inputs)
from .creative_clips_only_rate_snapshots import clips_only_operator_rate_snapshots
from .creative_composite_quote import CompositeQuoteReadiness, canonical_json
from .onboarding import StrictBody, require_user
from .security import require_origin

# Guía por defecto (la dirección fina la aporta el skill de ArtCraft). Dato de PRODUCTO/UX del dueño:
# si la pantalla «configurar» recoge un texto del cliente, llega en el cuerpo y sustituye a este default.
_DEFAULT_GUIDANCE = ('Anima la foto del producto con un movimiento sutil y natural, '
                     'manteniendo el producto fiel.')

_NOT_AUTHORIZABLE = {'error': 'not_authorizable',
                     'message': 'No se pudo autorizar esta cotización.'}
_QUOTE_FAILED = {'error': 'quote_failed',
                 'message': 'No se pudo preparar la cotización.'}
# Consultor bendijo `cloud_not_ready` (ya establecido en upload_route:57): la card ofrece reconexión.
_CLOUD_NOT_READY = {'error': 'cloud_not_ready',
                    'message': 'Conecta tu Google Cloud para animar la foto.'}
# C1 (REA re-x-ray): /quote (ya montado) ESCRIBE (ensure crea draft+hilo), así que debe estar gateado al
# MISMO allowlist piloto que la subida (creative_clips_only_upload_route.py:86) — no basta require_user.
_PILOT_ONLY = {'error': 'pilot_only',
               'message': 'El Estudio no está disponible para tu cuenta.'}


def _require_pilot(settings, user) -> None:
    """Rechaza (403) si el usuario de SESIÓN no está en el allowlist piloto de la subida. Fail-closed por
    ausencia (getattr → ()), patrón idéntico a la ruta de subida. El roster lo decide el dueño."""
    if str(user['id']) not in getattr(settings, 'creative_upload_pilot_user_ids', ()):
        raise HTTPException(403, detail=_PILOT_ONLY)

# Tipo de cambio PINADO y CONSERVADOR (€ por USD) para mostrar el MÁXIMO en € (D-PROTECCIÓN: la card
# muestra € SOLO, nunca USD). 1.00 sobreestima el € (el EUR suele valer < USD) → el máximo mostrado nunca
# queda por debajo del real; el redondeo del máximo es HACIA ARRIBA (ROUND_CEILING). Ajustable por el dueño.
_EUR_PER_USD = Decimal('1.00')


def _max_eur(max_total_usd: str) -> str:
    """Convierte el máximo USD a € server-side, conservador (FX pinado + redondeo al alza a céntimo)."""
    return str((Decimal(max_total_usd) * _EUR_PER_USD).quantize(
        Decimal('0.01'), rounding=ROUND_CEILING))


class QuoteClip(StrictBody):
    assetId: UUID = Field(strict=False)
    aspectRatio: str = Field(pattern=r'^(16:9|9:16)$')
    durationSeconds: int = Field(default=8)
    resolution: str = Field(default='720p', pattern=r'^720p$')
    guidance: str | None = Field(default=None, max_length=2000)


class _HttpClientAuthorizationGate:
    """SEAM «UX dueño» de la ruta: este código SOLO se alcanza tras un POST autenticado del CLIENTE
    (require_origin + require_user) al endpoint authorize de ESTE quote → el acto de autorización ES ese
    POST. El modelo no tiene ruta a este endpoint, así que no puede mintar una aprobación. La integridad
    la cierran aguas abajo `approve_composite_quote` (re-valida los shas de la cotización persistida) y la
    unicidad de la aprobación/job (una aprobación → un job durable)."""

    def client_acknowledged(self, request) -> bool:
        return True


def _readiness_from_quote_row(row: dict) -> CompositeQuoteReadiness:
    """Reconstruye la `CompositeQuoteReadiness` mínima desde la cotización persistida.

    `_closed_quote` y `build_clips_only_execution_graph` SOLO usan quote_snapshot_json/shas/max/expires
    (NO components_usd/payer_totals), así que basta con estos campos; ambos RE-VALIDAN los shas
    fail-closed contra la aprobación y el grafo, de modo que una reconstrucción errónea no pasa."""
    return CompositeQuoteReadiness(
        binding_sha256=row['binding_sha256'],
        complete=True,
        components_usd={},
        payer_totals_usd={},
        max_total_usd=str(row['max_total_usd']),
        missing_components=(),
        expires_at=row['expires_at'].isoformat(),
        costs_snapshot_sha256=row['costs_snapshot_sha256'],
        quote_snapshot_json=canonical_json(row['quote_snapshot']),
        quote_sha256=row['quote_sha256'],
        approval_ready=False,
        execution_authorized=False)


# Estado del clip para el sondeo del front (contrato v1.1-FINAL de Frontend-app): enum EXACTO de 5 cadenas.
# El front corta en ready/failed/unconfirmed y reprograma en queued/creating; cualquier otro valor → 502.
_STATUS_NOT_FOUND = {'error': 'status_not_found', 'message': 'No se encontró el clip.'}
# Misma ventana de vigencia que el gate_decider (clips_only_gate._DEFAULT_MAX_AGE): una confirmación vieja
# no cuenta (el precio pudo cambiar; re-confirmar) → el clip queda «unconfirmed», no «queued».
_CONFIRMATION_MAX_AGE = timedelta(hours=1)


def _clip_status(c, user, job_id: str, now: datetime) -> str:
    """Mapea el job 090 al enum de 6 del front (card-safe: NO expone ids/coste/url/hashes). F10 (estado
    HONESTO): si hubo un POST real (google_generation 'succeeded' con un intento succeeded que fijó
    provider_started_at) el estado JAMÁS es 'failed'/«sin coste» aunque el job haya fallado — es
    `generated_delivery_pending` (adopción en curso) o `generated_delivery_failed` (adopción terminal
    fallida). succeeded→ready; (SIN POST) failed/cancelled→failed [pre-POST, 0€]; running/unknown→creating;
    held/queued→queued si confirmación client_explicit vigente, si no unconfirmed. Fail-closed: desconocido
    →queued (ni termina el sondeo ni declara un fallo falso)."""
    row = c.execute(
        '''SELECT status FROM creative_execution_jobs
           WHERE user_id=%s AND id=%s''', (str(user['id']), job_id)).fetchone()
    status = row['status'] if row else None
    if status == 'succeeded':
        return 'ready'
    # F10: ¿hubo POST real (clip generado y COBRADO)? google_generation 'succeeded' con un intento
    # 'succeeded' que fijó provider_started_at. Si sí, el estado honesto depende de la ADOPCIÓN; NUNCA
    # 'failed'/«sin coste» tras un POST (regla dura).
    generated = c.execute(
        '''SELECT 1 FROM creative_execution_steps g
           JOIN creative_execution_attempts a ON a.user_id=g.user_id
             AND a.job_id=g.job_id AND a.step_id=g.step_id
           WHERE g.user_id=%s AND g.job_id=%s AND g.kind='google_generation'
             AND g.status='succeeded' AND a.status='succeeded'
             AND a.provider_started_at IS NOT NULL LIMIT 1''',
        (str(user['id']), job_id)).fetchone()
    if generated:
        adopt = c.execute(
            '''SELECT status FROM creative_execution_steps
               WHERE user_id=%s AND job_id=%s AND kind='storage_adopt' ''',
            (str(user['id']), job_id)).fetchone()
        adopt_status = adopt['status'] if adopt else None
        if adopt_status == 'succeeded':
            return 'ready'
        if adopt_status in ('failed', 'unknown', 'cancelled'):
            return 'generated_delivery_failed'
        return 'generated_delivery_pending'
    if status in ('failed', 'cancelled'):
        return 'failed'
    if status in ('running', 'unknown'):
        return 'creating'
    if status in ('held', 'queued'):
        confirmation = c.execute(
            '''SELECT source, confirmed_at FROM creative_execution_confirmations
               WHERE user_id=%s AND job_id=%s
               ORDER BY confirmed_at DESC LIMIT 1''',
            (str(user['id']), job_id)).fetchone()
        if (confirmation and confirmation['source'] == 'client_explicit'
                and isinstance(confirmation['confirmed_at'], datetime)
                and confirmation['confirmed_at'].tzinfo is not None
                and confirmation['confirmed_at'] <= now
                and now - confirmation['confirmed_at'] <= _CONFIRMATION_MAX_AGE):
            return 'queued'
        return 'unconfirmed'
    return 'queued'


# F10: compuerta D-PROTECCIÓN del deliveryReason — solo [a-z0-9_:] (identificadores del discriminador:
# adoption_rejected:http_400:invalid:name, claim_limit_reached, veo_poll_*…). RECHAZA '/', '-', mayúsculas,
# espacios, símbolos → ni gs://, ni uuid/project-id (llevan '-'), ni USD/hash pueden filtrarse.
_SAFE_REASON_CHARS = frozenset('abcdefghijklmnopqrstuvwxyz0123456789_:')


def _delivery_reason(c, user, job_id: str) -> str | None:
    """F10: error_code card-safe del storage_adopt para `generated_delivery_failed` (lo usa F11a; la UI NO
    lo muestra). Solo se devuelve si pasa la compuerta _SAFE_REASON_CHARS (≤80, [a-z0-9_:]); si no, None
    (fail-safe: nunca filtra ruta/uuid)."""
    adopt = c.execute(
        '''SELECT error_code FROM creative_execution_steps
           WHERE user_id=%s AND job_id=%s AND kind='storage_adopt' ''',
        (str(user['id']), job_id)).fetchone()
    code = adopt['error_code'] if adopt else None
    if (isinstance(code, str) and 0 < len(code) <= 80
            and all(ch in _SAFE_REASON_CHARS for ch in code)):
        return code
    return None


def _plan_card(thread_id: str, aspect_ratio: str, quote_id, max_eur) -> dict:
    """`estudioCard` kind='plan' card-safe (forma canónica del contrato v1.1)."""
    return {
        'kind': 'plan', 'threadId': thread_id, 'title': 'Clip para la ficha',
        'meta': {'format': 'Vídeo rápido', 'scenes': 1, 'durationSec': 8,
                 'aspect': aspect_ratio, 'resolution': '720p',
                 'engineLabel': 'Vídeo con IA de Google'},
        'items': [{'index': 1, 'title': 'Clip', 'state': 'enCola'}],
        'maxEur': max_eur,
        'payer': 'customer_google_project',
        'quoteId': quote_id,
    }


def routes(settings, database):
    router = APIRouter(prefix='/api/uony/threads/{thread_id}/creative-clips')

    @router.post('/quote')
    def quote(thread_id: str, body: QuoteClip, request: Request):
        require_origin(request, settings.origin)
        # Modelo B (decisión del dueño): el clip opera sobre un hilo Estudio DEDICADO (prefijo reservado),
        # nunca el del chat → el auto-draft no aparece en get_creative_plan/preparation del chat (sin tarjeta
        # fantasma). Fail-closed: un hilo no dedicado se rechaza antes de tocar la BD.
        if not is_estudio_clip_thread(thread_id):
            raise HTTPException(400, detail=_QUOTE_FAILED)
        issue_request_id = uuid4()
        now = datetime.now(timezone.utc)
        # Rate snapshots por CONFIG DE OPERADOR (veredicto Consultor): si faltan/malformados ⇒ (None, None)
        # ⇒ composer deja ceilings=() ⇒ readiness incompleta ⇒ «sin precio». El gate ≤24 h (_validate_rates
        # / infra) corre dentro de los ceilings contra `now`; si no valida, el composer degrada a «sin precio».
        generation_rates, infrastructure_rates = clips_only_operator_rate_snapshots(settings, now=now)
        with database.connect() as c:
            user = require_user(c, request)
            _require_pilot(settings, user)  # C1: gate piloto ANTES de cualquier escritura de `ensure`.
            # C4/B-INV-2: asegurar el DRAFT (reuse-or-create) con la MISMA conexión c, ANTES del anchor; el
            # advisory XACT lock de `ensure` queda retenido hasta el commit que cubre anchor+persist. No gasta.
            try:
                clips_only_ensure_plan_anchor(c, user=user, thread_id=thread_id)
            except ClipsOnlyCloudNotReadyError:
                raise HTTPException(409, detail=_CLOUD_NOT_READY) from None
            except ClipsOnlyPlanBootstrapError:
                raise HTTPException(409, detail=_QUOTE_FAILED) from None
            try:
                _, readiness, snapshots = clips_only_build_quote_inputs(
                    c, user=user, thread_id=thread_id, asset_id=str(body.assetId),
                    aspect_ratio=body.aspectRatio,
                    guidance=body.guidance or _DEFAULT_GUIDANCE,
                    compile_batch=compile_clips_only_animation_batch,
                    issue_request_id=issue_request_id, now=now,
                    generation_rates=generation_rates,
                    infrastructure_rates=infrastructure_rates)
            except ClipsOnlyFrameResolverError:
                raise HTTPException(404, detail=_QUOTE_FAILED) from None
            except (ClipsOnlyPlanAnchorError, ClipsOnlyInputGateError):
                raise HTTPException(409, detail=_QUOTE_FAILED) from None
            except (ClipsOnlyDraftError, ClipsOnlyBindingError, ValueError):
                raise HTTPException(400, detail=_QUOTE_FAILED) from None
            quote_id = None
            if readiness.complete:
                # Con techos reales: persistir la cotización idempotente y exponer su quoteId.
                try:
                    view = issue_clips_only_quote(c, user, issue_request_id, readiness, snapshots)
                except ClipsOnlyInputGateError:
                    raise HTTPException(409, detail={'error': 'creative_input_not_owned',
                                                     'message': _QUOTE_FAILED['message']}) from None
                except ValueError:
                    raise HTTPException(400, detail=_QUOTE_FAILED) from None
                quote_id = view['quoteId']
        # maxEur en € SOLO (D-PROTECCIÓN), conservador (FX pinado + redondeo al alza), server-side. Con
        # readiness incompleta (sin rates vigentes) ⇒ max_total_usd=None ⇒ maxEur=null («sin precio»).
        max_eur = _max_eur(readiness.max_total_usd) if readiness.complete else None
        return _plan_card(thread_id, body.aspectRatio, quote_id, max_eur)

    @router.post('/quotes/{quote_id}/authorize')
    def authorize(thread_id: str, quote_id: str, request: Request):
        require_origin(request, settings.origin)
        # Modelo B: la autorización del clip también opera sobre el hilo Estudio DEDICADO (la cotización se
        # persistió con ese thread_id). Fail-closed si llega un hilo no dedicado.
        if not is_estudio_clip_thread(thread_id):
            raise HTTPException(400, detail=_NOT_AUTHORIZABLE)
        now = datetime.now(timezone.utc)
        with database.connect() as c:
            user = require_user(c, request)
            _require_pilot(settings, user)  # C1: mismo gate piloto que /quote y la subida.
            row = c.execute(
                '''SELECT * FROM creative_execution_quotes
                   WHERE user_id=%s AND id=%s AND thread_id=%s''',
                (str(user['id']), quote_id, thread_id)).fetchone()
            if not row:
                raise HTTPException(400, detail=_NOT_AUTHORIZABLE)
            try:
                operations = row['quote_snapshot']['execution']['requestOperations']
                request_sha256 = operations[0]['requestSha256']
            except (KeyError, IndexError, TypeError):
                raise HTTPException(400, detail=_NOT_AUTHORIZABLE) from None
            readiness = _readiness_from_quote_row(row)
            quote_view = {
                'quoteId': str(row['id']), 'quoteSha256': row['quote_sha256'],
                'bindingSha256': row['binding_sha256'],
                'costsSnapshotSha256': row['costs_snapshot_sha256'],
                'maxTotalUsd': str(row['max_total_usd'])}
            # request_id determinista por acción authorize → re-POST idempotente (misma aprobación y job).
            request_id = uuid5(NAMESPACE_URL, f'uonify:clips-only-authorize:{row["id"]}')
            try:
                approval = authorize_clips_only_quote(
                    c, user, gate=_HttpClientAuthorizationGate(),
                    quote_view=quote_view, request_id=request_id, now=now)
                job = hold_clips_only_graph(c, user, request_id, readiness, approval, now=now)
                admit_clips_only_job(c, user, UUID(job['jobId']))
            except (ClipsOnlyAuthorizationError, ValueError):
                raise HTTPException(400, detail=_NOT_AUTHORIZABLE) from None
        return {'jobId': job['jobId'], 'requestSha256': request_sha256,
                'status': 'queued'}

    @router.get('/jobs/{job_id}/status')
    def job_status(thread_id: str, job_id: str, request: Request):
        # Sondeo del front (cada 2500 ms). Read-only: NO muta, NO despacha, NO gasta. Mismo gate piloto C1
        # y hilo Estudio DEDICADO que quote/authorize. Devuelve SOLO la forma card-safe del contrato.
        # FIX (E2E inerte 28-10): NO `require_origin` aquí. Es un GET del MISMO origen → el navegador NO
        # manda header `Origin` → require_origin daría 403 («invalid_origin») en CADA sondeo. El CSRF-origin
        # protege POSTs que CAMBIAN estado (quote/authorize/confirm lo mantienen); esta LECTURA la protege la
        # sesión (`require_user`) + el gate piloto + el scope user/thread/job, y la respuesta es card-safe.
        if not is_estudio_clip_thread(thread_id):
            raise HTTPException(404, detail=_STATUS_NOT_FOUND)
        try:
            job_uuid = str(UUID(job_id))
        except (ValueError, TypeError):
            raise HTTPException(404, detail=_STATUS_NOT_FOUND) from None
        now = datetime.now(timezone.utc)
        with database.connect() as c:
            user = require_user(c, request)
            _require_pilot(settings, user)
            row = c.execute(
                '''SELECT id FROM creative_execution_jobs
                   WHERE user_id=%s AND id=%s AND thread_id=%s''',
                (str(user['id']), job_uuid, thread_id)).fetchone()
            if not row:
                raise HTTPException(404, detail=_STATUS_NOT_FOUND)
            status = _clip_status(c, user, job_uuid, now)
        # Clip simple = 1 escena; el estado de la escena = el del job (card-safe: index/title/state).
        return {'jobId': job_uuid, 'status': status,
                'scenes': [{'index': 1, 'title': 'Clip', 'state': status}]}

    @router.get('/jobs/latest')
    def jobs_latest(thread_id: str, request: Request, include: str = ''):
        # F11a: rehidratación de la tarjeta del Estudio al montar el hilo (el front NO depende del asset en
        # memoria). Read-only: NO muta, NO despacha, NO gasta. Mismo gate C1 + hilo Estudio DEDICADO que
        # job_status; respuesta card-safe. Devuelve el ÚLTIMO job del hilo; con `include=terminal` también
        # los estados terminales (ready/failed/generated_delivery_failed), si no → 404 (el front solo reanuda
        # los in-progress). Sin `require_origin` (GET mismo-origen, como job_status).
        if not is_estudio_clip_thread(thread_id):
            raise HTTPException(404, detail=_STATUS_NOT_FOUND)
        now = datetime.now(timezone.utc)
        with database.connect() as c:
            user = require_user(c, request)
            _require_pilot(settings, user)
            row = c.execute(
                '''SELECT id, created_at FROM creative_execution_jobs
                   WHERE user_id=%s AND thread_id=%s
                   ORDER BY created_at DESC LIMIT 1''',
                (str(user['id']), thread_id)).fetchone()
            if not row:
                raise HTTPException(404, detail=_STATUS_NOT_FOUND)
            job_uuid = str(row['id'])
            status = _clip_status(c, user, job_uuid, now)
            if (status in ('ready', 'failed', 'generated_delivery_failed')
                    and 'terminal' not in include):
                raise HTTPException(404, detail=_STATUS_NOT_FOUND)
            delivery_reason = (_delivery_reason(c, user, job_uuid)
                               if status == 'generated_delivery_failed' else None)
            created_at = row['created_at']
        payload = {
            'jobId': job_uuid, 'status': status,
            'scenes': [{'index': 1, 'title': 'Clip', 'state': status}],
            'createdAt': (created_at.isoformat()
                          if isinstance(created_at, datetime) else None)}
        if delivery_reason:
            payload['deliveryReason'] = delivery_reason
        return payload

    return router
