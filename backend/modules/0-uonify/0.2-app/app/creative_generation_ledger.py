"""Closed creative quote/approval ledger; it never calls a media provider.

Only trusted backend pricing may call issue_complete_quote. There is no HTTP
quote-creation or attempt-reservation route. Current pricing is incomplete, so
no production caller issues a quote and the dispatch gate remains closed.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
import json
import re
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, UUID, uuid4, uuid5

from psycopg.types.json import Jsonb

from .creative_google_capabilities import model_location
from .creative_google_provider_namespace import google_provider_output_uri
from .creative_image_contracts import ImageRequest
from .creative_music_contracts import MusicRequest
from .creative_request_fingerprint import fingerprint, request_snapshot
from .creative_video_contracts import VideoRequest, veo_endpoint_host
from .creative_voiceover_contracts import VoiceoverRequest
from .products import fail, require_access

HASH = re.compile(r'[0-9a-f]{64}\Z')
COMPONENTS = frozenset({'generation', 'storage', 'processing', 'transfer'})
REQUEST_TYPES = {ImageRequest: 'image', VideoRequest: 'video',
                 MusicRequest: 'music', VoiceoverRequest: 'voiceover'}
PRODUCTION_DISPATCH_ENABLED = False


@dataclass(frozen=True)
class CompleteCost:
    """Trusted server-side ceiling for exactly one provider request.

    No existing pricing estimator constructs this: the observed Veo subtotal
    explicitly excludes other costs and has approval_ready=False.
    """
    components_usd: dict[str, Decimal]
    max_total_usd: Decimal
    evidence_sha256: str
    checked_at: datetime
    expires_at: datetime
    complete: bool


def digest(value):
    canonical = json.dumps(value, sort_keys=True, ensure_ascii=False,
                           separators=(',', ':'), allow_nan=False)
    return sha256(canonical.encode('utf-8')).hexdigest()


def _active_user(c, user):
    row = c.execute('SELECT * FROM users WHERE id=%s FOR SHARE',
                    (user['id'],)).fetchone()
    if not row or row.get('deletion_requested_at'):
        fail('session_required', 'Vuelve a iniciar sesión para continuar.', 401)
    if row['google_subject'] != user['google_subject']:
        fail('creative_identity_changed', 'La identidad de Google ha cambiado.', 409)
    require_access(c, row)
    return row


def _source(c, user, plan_id, *, lock=True):
    plan = c.execute('''SELECT * FROM uony_creative_plans
        WHERE user_id=%s AND id=%s''' + (' FOR UPDATE' if lock else ''),
        (user['id'], plan_id)).fetchone()
    if not plan or plan['google_subject'] != user['google_subject'] or plan['status'] != 'draft':
        fail('creative_plan_not_found', 'No se encuentra un plan creativo vigente.', 404)
    thread = c.execute('''SELECT project_id,deleted_at FROM uony_threads
        WHERE user_id=%s AND id=%s FOR SHARE''',
        (user['id'], plan['thread_id'])).fetchone()
    if not thread or thread['deleted_at']:
        fail('creative_thread_changed', 'La conversación de este plan ya no está disponible.', 409)
    newest = c.execute('''SELECT id FROM uony_creative_plans
        WHERE user_id=%s AND thread_id=%s ORDER BY created_at DESC,id DESC LIMIT 1''',
        (user['id'], plan['thread_id'])).fetchone()
    if not newest or newest['id'] != plan['id']:
        fail('creative_plan_superseded', 'Hay un plan más reciente para esta conversación.', 409)
    cloud = c.execute('''SELECT google_subject,project_id,status,project_check
        FROM google_cloud_connections WHERE user_id=%s FOR SHARE''',
        (user['id'],)).fetchone()
    checks = cloud['project_check'] if cloud else None
    if (not cloud or cloud['google_subject'] != user['google_subject']
            or cloud['project_id'] != plan['project_id'] or cloud['status'] != 'connected'
            or not isinstance(checks, dict) or checks.get('ready') is not True
            or checks.get('billing') != 'enabled'):
        fail('creative_payer_changed', 'Revisa la conexión y facturación del proyecto Google.', 409)
    if thread['project_id']:
        project = c.execute('''SELECT deleted_at FROM uony_projects
            WHERE user_id=%s AND id=%s FOR SHARE''',
            (user['id'], thread['project_id'])).fetchone()
        if not project or project['deleted_at']:
            fail('creative_project_changed', 'El proyecto de Uonify ha cambiado.', 409)
    if plan['product_id']:
        product = c.execute('''SELECT revision,deleted_at FROM products
            WHERE user_id=%s AND id=%s FOR SHARE''',
            (user['id'], plan['product_id'])).fetchone()
        if not product or product['deleted_at'] or product['revision'] != plan['product_revision']:
            fail('creative_product_changed', 'La ficha ha cambiado desde el plan.', 409)
    snapshot = {'recipe': plan['recipe'], 'plan': plan['plan'],
                'skillVersion': plan['skill_version'],
                'productId': str(plan['product_id']) if plan['product_id'] else None,
                'productRevision': plan['product_revision']}
    return plan, thread, snapshot, digest(snapshot)


def _price(cost):
    if not isinstance(cost, CompleteCost) or cost.complete is not True:
        fail('creative_full_price_missing', 'Falta un coste máximo completo y verificado.', 409)
    parts = cost.components_usd
    if not isinstance(parts, dict) or set(parts) != COMPONENTS:
        fail('creative_full_price_missing', 'El presupuesto no cubre todos los conceptos.', 409)
    if any(not isinstance(amount, Decimal) or not amount.is_finite()
           or amount < 0 or amount.as_tuple().exponent < -2 for amount in parts.values()):
        fail('creative_full_price_invalid', 'Revisa los importes del presupuesto.', 409)
    total = cost.max_total_usd
    if (not isinstance(total, Decimal) or not total.is_finite() or total <= 0
            or total.as_tuple().exponent < -2 or total < sum(parts.values(), Decimal(0))
            or parts['generation'] <= 0):
        fail('creative_full_price_invalid', 'El máximo no cubre la generación.', 409)
    now = datetime.now(timezone.utc)
    if (not HASH.fullmatch(cost.evidence_sha256) or not cost.checked_at.tzinfo
            or not cost.expires_at.tzinfo or cost.checked_at > now
            or now - cost.checked_at > timedelta(days=1)
            or cost.expires_at <= now or cost.expires_at > now + timedelta(days=1)):
        fail('creative_price_evidence_invalid', 'La evidencia de precio no está vigente.', 409)
    return {'componentsUsd': {key: str(parts[key]) for key in sorted(parts)},
            'maxTotalUsd': str(total), 'evidenceSha256': cost.evidence_sha256,
            'checkedAt': cost.checked_at.isoformat(), 'complete': True,
            'coverage': 'one_exact_request_all_external_and_operational_costs'}


def _request(request, project_id, expected_model):
    operation = REQUEST_TYPES.get(type(request))
    if not operation:
        fail('creative_request_invalid', 'La petición multimedia no está admitida.', 409)
    if request.model != expected_model:
        fail('creative_model_changed', 'El motor no coincide con el plan elegido.', 409)
    # §H/H5: el host y la location se DERIVAN del catálogo por modelo (residencia pinada), no son
    # parámetro libre. Veo es regional (us-central1-aiplatform…), imagen/Lyria/Omni global
    # (aiplatform…), TTS europe-southwest1; cada uno con su host EXACTO. Sin wildcard (anti-SSRF): el
    # host debe ser == veo_endpoint_host(location del catálogo) y la location del path == esa misma.
    url = urlsplit(request.endpoint)
    match = re.search(r'/projects/([^/]+)/locations/([^/]+)/', url.path)
    location = model_location(request.model)
    expected_host = veo_endpoint_host(location) if location else None
    if (url.scheme != 'https' or not expected_host or url.hostname != expected_host
            or not match or match.group(1) != project_id or match.group(2) != location):
        fail('creative_request_project_changed', 'La petición apunta a otro proyecto Google.', 409)
    exact = fingerprint(request)
    # §H: las entradas YA NO se rechazan aquí. El snapshot lleva el manifiesto REAL (su huella es
    # exact.sha256 por construcción, misma canonicalización que digest). La PROPIEDAD de cada entrada
    # (owned+allowed, atada a su identidad uri+generation+sha256) la verifica issue_complete_quote,
    # que tiene conexión y usuario: fail-closed ANTES de emitir cuota y, por tanto, antes de todo POST.
    # _request sigue puro (sin DB). Una petición sin entradas mantiene el manifiesto vacío de siempre.
    snapshot = request_snapshot(request)
    return operation, exact.sha256, snapshot


def _verify_inputs_owned(c, user, manifest):
    """§H gate de ENTRADA (veredicto 20261022, cond. 4): cada entrada de la petición debe ser
    PROPIEDAD del usuario y estar 'allowed', atada a su IDENTIDAD exacta — uri gs://bucket/name +
    generation + sha256 (de creative_owned_inputs, store de §B), no solo al sha256. Fail-closed:
    si una entrada no trae esa identidad GCS o no existe una fila owned+allowed que case EXACTO →
    creative_input_not_owned, ANTES de emitir cuota (y por tanto antes de todo POST). Keyed por
    user_id (binding H6). NO toca la salida (H5/§6/durable siguen igual). Una petición sin entradas
    (manifiesto vacío) no consulta nada y pasa, como antes."""
    for item in manifest:
        uri = item.get('uri') if isinstance(item, dict) else None
        generation = item.get('generation') if isinstance(item, dict) else None
        sha = item.get('sha256') if isinstance(item, dict) else None
        parsed = urlsplit(uri) if isinstance(uri, str) else None
        name = parsed.path.lstrip('/') if parsed else None
        if (not parsed or parsed.scheme != 'gs' or not parsed.netloc or not name
                or parsed.query or parsed.fragment or parsed.path.endswith('/')
                or not isinstance(generation, int) or isinstance(generation, bool)
                or generation <= 0 or not isinstance(sha, str)):
            fail('creative_input_not_owned', 'Una entrada no es un recurso propio verificado.', 409)
        owned = c.execute('''SELECT 1 FROM creative_owned_inputs
            WHERE user_id=%s AND sha256=%s AND storage_bucket=%s AND storage_name=%s
              AND storage_generation=%s AND authorization_state='allowed'
            FOR SHARE''',
            (user['id'], sha, parsed.netloc, name, generation)).fetchone()
        if not owned:
            fail('creative_input_not_owned', 'Una entrada no es un recurso propio verificado.', 409)


def _quote_view(row, *, source_current):
    return {'quoteId': str(row['id']), 'planId': str(row['plan_id']),
            'threadId': row['thread_id'], 'uonifyProjectId': str(row['uonify_project_id'])
            if row['uonify_project_id'] else None,
            'googleCloudProjectId': row['google_project_id'], 'payer': row['payer'],
            'planRevision': row['plan_revision'], 'planSha256': row['plan_sha256'],
            'operation': row['operation'], 'model': row['model'],
            'requestSha256': row['request_sha256'], 'quoteSha256': row['quote_sha256'],
            'pricing': row['pricing_snapshot'], 'maxTotalUsd': str(row['max_total_usd']),
            'expiresAt': row['expires_at'].isoformat(), 'sourceCurrent': source_current,
            'generationStarted': False}


def _quote_current(c, user, row):
    try:
        plan, thread, _, plan_hash = _source(c, user, row['plan_id'])
    except Exception as error:
        from fastapi import HTTPException
        if isinstance(error, HTTPException) and error.status_code in (404, 409):
            return False
        raise
    return (plan['revision'] == row['plan_revision'] and plan_hash == row['plan_sha256']
            and plan['thread_id'] == row['thread_id']
            and thread['project_id'] == row['uonify_project_id']
            and plan['project_id'] == row['google_project_id']
            and row['expires_at'] > datetime.now(timezone.utc))


def issue_complete_quote(c, user, plan_id: UUID, issue_request_id: UUID,
                         request, cost: CompleteCost):
    """Private contract for future audited pricing; never called by HTTP."""
    user = _active_user(c, user)
    pricing = _price(cost)
    plan, thread, snapshot, plan_hash = _source(c, user, plan_id)
    chosen = plan['plan'].get('modelChoice')
    if plan['plan'].get('modelSnapshot', {}).get('medium') == 'vídeo' and not chosen:
        fail('creative_model_not_chosen', 'Elige el modelo de vídeo antes de cotizar.', 409)
    expected = chosen or plan['plan'].get('modelSnapshot', {}).get('model')
    operation, request_hash, request_snapshot = _request(request, plan['project_id'], expected)
    _verify_inputs_owned(c, user, request_snapshot['inputManifest'])   # §H: gate de propiedad de ENTRADA
    medium = plan['plan'].get('modelSnapshot', {}).get('medium')
    if (medium == 'imagen' and operation != 'image'
            or medium == 'vídeo' and operation != 'video'
            or medium not in ('imagen', 'vídeo')):
        fail('creative_operation_mismatch', 'La operación no coincide con el plan.', 409)
    quote_body = {'planId': str(plan_id), 'threadId': plan['thread_id'],
                  'uonifyProjectId': str(thread['project_id']) if thread['project_id'] else None,
                  'googleSubject': user['google_subject'],
                  'googleCloudProjectId': plan['project_id'], 'payer': 'customer_google_project',
                  'planRevision': plan['revision'], 'planSha256': plan_hash,
                  'productId': str(plan['product_id']) if plan['product_id'] else None,
                  'productRevision': plan['product_revision'], 'operation': operation,
                  'requestSha256': request_hash, 'pricing': pricing,
                  'maxTotalUsd': str(cost.max_total_usd),
                  'expiresAt': cost.expires_at.isoformat()}
    quote_hash = digest(quote_body)
    prior = c.execute('''SELECT * FROM creative_generation_quotes
        WHERE user_id=%s AND issue_request_id=%s''',
        (user['id'], issue_request_id)).fetchone()
    if prior:
        if prior['quote_sha256'] != quote_hash:
            fail('creative_quote_request_conflict', 'Esta petición ya tiene otra cotización.', 409)
        return _quote_view(prior, source_current=_quote_current(c, user, prior))
    row = c.execute('''INSERT INTO creative_generation_quotes
        (id,user_id,issue_request_id,plan_id,thread_id,uonify_project_id,
         google_subject,google_project_id,payer,plan_revision,plan_sha256,
         plan_snapshot,product_id,product_revision,operation,model,endpoint,
         request_sha256,request_snapshot,input_manifest,pricing_snapshot,
         max_total_usd,quote_sha256,expires_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,'customer_google_project',%s,%s,%s,
               %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (user_id,issue_request_id) DO NOTHING RETURNING *''',
        (uuid4(), user['id'], issue_request_id, plan_id, plan['thread_id'],
         thread['project_id'], user['google_subject'], plan['project_id'],
         plan['revision'], plan_hash, Jsonb(snapshot), plan['product_id'],
         plan['product_revision'], operation, request.model, request.endpoint,
         request_hash, Jsonb(request_snapshot), Jsonb(request_snapshot['inputManifest']),
         Jsonb(pricing), cost.max_total_usd, quote_hash, cost.expires_at)).fetchone()
    if not row:
        prior = c.execute('''SELECT * FROM creative_generation_quotes
            WHERE user_id=%s AND issue_request_id=%s''',
            (user['id'], issue_request_id)).fetchone()
        if not prior or prior['quote_sha256'] != quote_hash:
            fail('creative_quote_request_conflict', 'Esta petición ya tiene otra cotización.', 409)
        row = prior
    return _quote_view(row, source_current=True)


def get_quote(c, user, thread_id, quote_id):
    user = _active_user(c, user)
    row = c.execute('''SELECT * FROM creative_generation_quotes
        WHERE user_id=%s AND thread_id=%s AND id=%s''',
        (user['id'], thread_id, quote_id)).fetchone()
    if not row:
        fail('creative_quote_not_found', 'No se encuentra esta cotización.', 404)
    return _quote_view(row, source_current=_quote_current(c, user, row))


def _approval_view(row, current):
    return {'approvalId': str(row['id']), 'quoteId': str(row['quote_id']),
            'requestId': str(row['request_id']), 'actorId': str(row['actor_id']),
            'quoteSha256': row['quote_sha256'], 'planRevision': row['plan_revision'],
            'planSha256': row['plan_sha256'], 'requestSha256': row['request_sha256'],
            'maxTotalUsd': str(row['max_total_usd']),
            'approvedAt': row['approved_at'].isoformat(), 'sourceCurrent': current,
            'generationStarted': False}


def approve_exact(c, user, thread_id, quote_id, request_id, quote_hash,
                  plan_revision, plan_hash, request_hash, max_total, acknowledged):
    user = _active_user(c, user)
    if acknowledged is not True:
        fail('creative_approval_required', 'Confirma el máximo y la petición exacta.', 422)
    row = c.execute('''SELECT * FROM creative_generation_quotes
        WHERE user_id=%s AND thread_id=%s AND id=%s FOR SHARE''',
        (user['id'], thread_id, quote_id)).fetchone()
    if not row:
        fail('creative_quote_not_found', 'No se encuentra esta cotización.', 404)
    exact = (row['quote_sha256'] == quote_hash
             and row['plan_revision'] == plan_revision and row['plan_sha256'] == plan_hash
             and row['request_sha256'] == request_hash and row['max_total_usd'] == max_total)
    if not exact:
        fail('creative_approval_mismatch', 'La cotización ha cambiado. Revísala otra vez.', 409)
    prior = c.execute('''SELECT * FROM creative_generation_approvals
        WHERE user_id=%s AND request_id=%s''',
        (user['id'], request_id)).fetchone()
    if prior:
        if prior['quote_id'] != quote_id:
            fail('creative_approval_request_conflict', 'Esta petición ya aprobó otra cotización.', 409)
        return _approval_view(prior, _quote_current(c, user, row))
    if not _quote_current(c, user, row):
        fail('creative_quote_stale', 'El plan, proyecto o precio ha cambiado.', 409)
    prior = c.execute('''SELECT * FROM creative_generation_approvals
        WHERE user_id=%s AND quote_id=%s''',
        (user['id'], quote_id)).fetchone()
    if prior:
        fail('creative_quote_already_approved', 'Esta cotización ya tiene aprobación.', 409)
    approved = c.execute('''INSERT INTO creative_generation_approvals
        (id,user_id,quote_id,request_id,actor_id,quote_sha256,plan_revision,
         plan_sha256,request_sha256,max_total_usd)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT DO NOTHING RETURNING *''',
        (uuid4(), user['id'], quote_id, request_id, user['id'], quote_hash,
         plan_revision, plan_hash, request_hash, max_total)).fetchone()
    if not approved:
        prior = c.execute('''SELECT * FROM creative_generation_approvals
            WHERE user_id=%s AND request_id=%s''',
            (user['id'], request_id)).fetchone()
        if not prior or prior['quote_id'] != quote_id:
            fail('creative_quote_already_approved', 'Esta cotización ya tiene aprobación.', 409)
        approved = prior
    return _approval_view(approved, True)


def get_approval(c, user, thread_id, approval_id):
    user = _active_user(c, user)
    row = c.execute('''SELECT a.*,q.plan_id,q.thread_id,q.expires_at
        FROM creative_generation_approvals a JOIN creative_generation_quotes q
        ON q.user_id=a.user_id AND q.id=a.quote_id
        WHERE a.user_id=%s AND q.thread_id=%s AND a.id=%s''',
        (user['id'], thread_id, approval_id)).fetchone()
    if not row:
        fail('creative_approval_not_found', 'No se encuentra esta aprobación.', 404)
    quote = c.execute('''SELECT * FROM creative_generation_quotes
        WHERE user_id=%s AND id=%s''', (user['id'], row['quote_id'])).fetchone()
    return _approval_view(row, _quote_current(c, user, quote))


def reserve_once(c, user, approval_id, request_id, *, gate_open=False,
                 output_bucket=None):
    """Internal only. Commit this reservation before a future provider call.

    §6 (release creativo): para un intento Veo DURABLE el llamador del servidor pasa
    `output_bucket` (de la allowlist de SALIDA de config). Entonces la reserva minta UNA
    vez el operationUuid del INTENTO (determinista sobre el attempt_id; un reintento es un
    intento/fila nueva con su propio prefijo) y PERSISTE output_prefix (columna de la 129,
    inmutable). Sin `output_bucket` (resto de flujos, p. ej. amazon o no-Veo) output_prefix
    queda NULL. El gate LEE el prefijo persistido; nunca lo regenera."""
    user = _active_user(c, user)
    prior = c.execute('''SELECT * FROM creative_generation_attempts
        WHERE user_id=%s AND request_id=%s''', (user['id'], request_id)).fetchone()
    if prior:
        if prior['approval_id'] != approval_id:
            fail('creative_attempt_request_conflict', 'Este intento pertenece a otra aprobación.', 409)
        return _attempt_view(prior), False
    if not gate_open or not PRODUCTION_DISPATCH_ENABLED:
        fail('creative_generation_disabled', 'La generación aún no está habilitada.', 409)
    approval = c.execute('''SELECT * FROM creative_generation_approvals
        WHERE user_id=%s AND id=%s FOR SHARE''',
        (user['id'], approval_id)).fetchone()
    if not approval:
        fail('creative_approval_not_found', 'No se encuentra esta aprobación.', 404)
    quote = c.execute('''SELECT * FROM creative_generation_quotes
        WHERE user_id=%s AND id=%s FOR SHARE''',
        (user['id'], approval['quote_id'])).fetchone()
    if (not quote or quote['input_manifest'] or not _quote_current(c, user, quote)
            or approval['quote_sha256'] != quote['quote_sha256']
            or approval['request_sha256'] != quote['request_sha256']
            or approval['max_total_usd'] != quote['max_total_usd']):
        fail('creative_approval_stale', 'El trabajo no coincide con la aprobación.', 409)
    attempt_id = uuid4()
    output_prefix = None
    if output_bucket is not None:
        operation_id = str(uuid5(
            NAMESPACE_URL, 'creative-attempt-operation:' + str(attempt_id)))
        output_prefix = google_provider_output_uri(
            output_bucket, str(user['id']), str(attempt_id), operation_id)
    row = c.execute('''INSERT INTO creative_generation_attempts
        (id,user_id,approval_id,request_id,status,output_prefix)
        VALUES(%s,%s,%s,%s,'reserved',%s)
        ON CONFLICT DO NOTHING RETURNING *''',
        (attempt_id, user['id'], approval_id, request_id, output_prefix)).fetchone()
    if not row:
        prior = c.execute('''SELECT * FROM creative_generation_attempts
            WHERE user_id=%s AND approval_id=%s''',
            (user['id'], approval_id)).fetchone()
        if prior and prior['request_id'] == request_id:
            return _attempt_view(prior), False
        fail('creative_approval_already_used', 'Esta aprobación ya tiene un intento.', 409)
    return _attempt_view(row), True


def _attempt_view(row):
    return {'attemptId': str(row['id']), 'approvalId': str(row['approval_id']),
            'requestId': str(row['request_id']), 'status': row['status'],
            'reservedAt': row['reserved_at'].isoformat(),
            'finishedAt': row['finished_at'].isoformat() if row['finished_at'] else None,
            'outputPrefix': row['output_prefix']}


def mark_unknown(c, user_id, attempt_id, code='provider_outcome_unknown'):
    """An uncertain result is terminal for automatic retry, pending reconciliation."""
    row = c.execute('''UPDATE creative_generation_attempts
        SET status='unknown',finished_at=now(),error_code=%s
        WHERE user_id=%s AND id=%s AND status='reserved' RETURNING *''',
        (code, user_id, attempt_id)).fetchone()
    if not row:
        row = c.execute('''SELECT * FROM creative_generation_attempts
            WHERE user_id=%s AND id=%s''', (user_id, attempt_id)).fetchone()
    if not row:
        fail('creative_attempt_not_found', 'No se encuentra este intento.', 404)
    return _attempt_view(row)
