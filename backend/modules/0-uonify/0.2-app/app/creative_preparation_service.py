"""Vista de preparación creativa vigente; consulta pura, sin crear trabajos."""

from .creative_generation_ledger import digest
from .creative_planning import (VIDEO_MODEL_LABELS, PlanInput,
                                SOURCE_SHA256, compatible_video_models, route)
from .creative_skill_compiler import compile_skill_plan
from .products import fail


def _draft_view(compilation):
    return {
        'status': 'not_prepared',
        'snapshotSha256': None,
        'requestGroupSha256': None,
        'requestHashes': [],
        'unitIds': [item.unit_id for item in compilation.units],
        'executionAuthorized': False,
    }


def get_creative_preparation(connection, user, thread_id: str):
    """Recupera el plan del dueño y explica por qué aún no puede cotizarse."""
    row = connection.execute('''SELECT p.*,
        thread.project_id AS thread_project_id,
        thread.deleted_at AS thread_deleted_at,
        products.revision AS current_product_revision,
        cloud.project_id AS current_google_project
        FROM uony_threads thread
        LEFT JOIN LATERAL (
            SELECT candidate.* FROM uony_creative_plans candidate
            WHERE candidate.user_id=thread.user_id
              AND candidate.google_subject=%s
              AND candidate.thread_id=thread.id
            ORDER BY candidate.created_at DESC,candidate.id DESC LIMIT 1
        ) p ON TRUE
        LEFT JOIN products ON products.user_id=p.user_id
            AND products.id=p.product_id AND products.deleted_at IS NULL
        LEFT JOIN google_cloud_connections cloud ON cloud.user_id=p.user_id
            AND cloud.google_subject=p.google_subject AND cloud.status='connected'
        WHERE thread.user_id=%s AND thread.id=%s''',
        (user['google_subject'], user['id'], thread_id)).fetchone()
    if not row or row['thread_deleted_at']:
        fail('thread_not_found', 'No se encuentra esta conversación.', 404)
    if row['id'] is None:
        return None

    snapshot = {
        'recipe': row['recipe'], 'plan': row['plan'],
        'skillVersion': row['skill_version'],
        'productId': str(row['product_id']) if row['product_id'] else None,
        'productRevision': row['product_revision'],
    }
    plan_input = PlanInput.model_validate({
        key: value for key, value in row['plan'].items()
        if key in PlanInput.model_fields
    })
    compilation = compile_skill_plan(plan_input, row['project_id'])
    product_current = (row['product_id'] is None
                       or row['product_revision'] == row['current_product_revision'])
    project_current = row['project_id'] == row['current_google_project']
    stale = row['status'] == 'stale' or not product_current or not project_current
    missing = list(compilation.plan_blockers)
    technical = []
    if compilation.request_compile_ready:
        technical.extend((
            'preparar y persistir la estrategia trazable por unidad',
            'preparar y persistir la dirección exacta de cada unidad',
        ))
    if stale:
        technical.insert(0, 'actualizar el plan tras el cambio de proyecto o producto')
    technical.extend((
        'cerrar almacenamiento, procesamiento y transferencia aplicables',
        'persistir ownership, revisión y recibos de los assets',
        'enlazar el intento a la cola durable con lease y cierre CAS',
    ))
    missing = list(dict.fromkeys(missing))
    technical = list(dict.fromkeys(technical))
    model = row['plan'].get('modelSnapshot')
    if not isinstance(model, dict):
        model = route(row['recipe'], row['project_id'],
                      row['plan'].get('modelChoice'))
    view = {'model': model, 'plan': row['plan'],
            'sourceSha256': row['plan'].get('sourceSha256', SOURCE_SHA256)}
    options = compatible_video_models(view)
    return {
        'planId': str(row['id']), 'revision': row['revision'],
        'planSha256': digest(snapshot), 'threadId': row['thread_id'],
        'uonifyProjectId': (str(row['thread_project_id'])
                            if row['thread_project_id'] else None),
        'googleCloudProjectId': row['project_id'],
        'state': ('stale' if stale else 'needs_input'
                  if compilation.plan_blockers else 'needs_preparation'),
        'sourceCurrent': not stale,
        'model': view['model'],
        'compatibleModels': [
            {'id': model, 'label': VIDEO_MODEL_LABELS[model]} for model in options],
        'draft': _draft_view(compilation),
        'missingInputs': missing,
        'technicalBlockers': technical,
        'quoteReadiness': {
            'knownGenerationComponentUsd': None,
            'completeMaximumUsd': None,
            'currency': 'USD',
            'approvalReady': False,
            'missingForMaximum': list(dict.fromkeys((*missing, *technical))),
        },
        'limits': {
            'spendLimitUsd': str(row['spend_limit_usd']),
            'providerCallsStarted': 0,
            'executionAuthorized': False,
        },
    }
