"""Explicit semantic preparation; reads expose state without invoking a model."""
from copy import deepcopy
from uuid import UUID, uuid4
import hashlib
import json
from psycopg.types.json import Jsonb
from fastapi import HTTPException
from .google_cloud_provider import CloudError
from .products import fail, require_access
from .product_materials_amazon import belongs_to_product, eligible_job, latest_job
from .product_reasoning_queue import ReasoningQueue


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def product_signature(product):
    keys = ('name', 'brand', 'category', 'description', 'bullets', 'keywords', 'customFields',
            'price', 'cost', 'stock', 'amazonAttributes', 'amazonRequirementsContext')
    return digest({k: product.get(k) for k in keys})


def material_signature(job):
    return digest({'id': job['id'], 'status': job.get('status'), 'stale': job.get('facts', {}).get('stale'),
        'facts': job.get('facts', {}).get('proposals', []),
        'sources': [{k: s.get(k) for k in ('id', 'version', 'sha256', 'modifiedTime', 'changed')}
                    for s in job.get('sources', [])]})


def policy():
    from .product_reasoning_context import VERSION
    from .product_reasoning_provider import PROMPT_VERSION, ANALYSIS_MODEL, ANALYSIS_EFFORT
    return {'context': VERSION, 'prompt': PROMPT_VERSION, 'model': ANALYSIS_MODEL, 'effort': ANALYSIS_EFFORT}


def blocked_retry(result):
    if result.get('error') == 'evidence_incomplete':
        # The old worker stopped before verification. Reuse its paid proposal once
        # under the corrected verification contract; do not repeat an incomplete v2 result.
        from .product_reasoning_provider import VERIFY_VERSION
        return result.get('verificationContractVersion', 0) >= VERIFY_VERSION
    if result.get('error') == 'verification_rejected':
        from .product_reasoning_reconciliation import VALIDATION_RESOLUTION_VERSION
        # Reconcile the two paid responses without a new proposal. A partially
        # applied historical round needs separate review, not blind replay.
        return (result.get('validationResolutionVersion', 0) >= VALIDATION_RESOLUTION_VERSION
                or bool(result.get('rejectedTargetIds')))
    return result.get('error') in ('budget_exhausted', 'reasoning_limit', 'response_incomplete', 'response_repair_required')


MESSAGES = {
    'queued': 'Estoy reuniendo la información para completar los datos que faltan.',
    'running': 'Estoy contrastando tus documentos e imágenes antes de preguntarte.',
    'completed': 'He terminado de contrastar tu información. Solo quedan los datos que no he podido resolver.',
    'error': 'No pude terminar la comprobación. Tus datos se conservan; puedes volver a intentarlo.',
    'unknown': 'La comprobación se interrumpió y no sabemos si el proveedor completó el trabajo. Reintentarlo puede generar consumo adicional.',
    'stale': 'La ficha o sus fuentes han cambiado. Vuelve a comprobarlas antes de continuar.',
}


def unknown_consumption_message(usage):
    """Un bloqueo heredado no es una interrupción ni una llamada de esta revisión."""
    if usage.get('unknown') != 0:
        return MESSAGES['unknown']
    message = 'Hay un intento anterior cuyo consumo no pudimos confirmar. Tus datos están guardados.'
    if usage.get('calls') == 0:
        message += ' Esta revisión no ha iniciado llamadas nuevas.'
    return message + ' Antes de volver a intentarlo, confirma que aceptas el posible consumo adicional de IA.'


class ProductReasoning:
    def __init__(self, settings, database, materials, requirements, provider=None):
        self.settings, self.database = settings, database
        self.materials, self.requirements = materials, requirements
        self.queue = ReasoningQueue(database)
        if provider is None:
            from .product_reasoning_provider import ProductReasoner
            provider = ProductReasoner()
        self.provider = provider

    def _context_raw(self, c, user, product, snapshot, job, requested_evidence=None):
        sources = [r['data'] for r in c.execute('SELECT data FROM product_material_sources WHERE job_id=%s ORDER BY source_id', (job['id'],)).fetchall()]
        fragments = c.execute("SELECT * FROM product_material_fragments WHERE job_id=%s AND state NOT IN ('split','superseded') ORDER BY id", (job['id'],)).fetchall()
        return self.context_from_records(product, snapshot, job, sources, fragments, requested_evidence)

    def context_from_records(self, product, snapshot, job, sources, fragments, requested_evidence=None):
        from .product_reasoning_context import build_context
        from .product_reasoning_source_context import attach_reconciliation_context
        context = build_context(product, snapshot, job, sources, fragments, requested_evidence=requested_evidence)
        context['_policy'] = policy()
        context['fingerprint'] = digest({'context': context['fingerprint'], 'policy': context['_policy']})
        from .product_reasoning_continuity import requirements_scope
        context['_requirementsScope'] = requirements_scope(snapshot)
        context['_materialSignature'] = material_signature(job)
        context['_sourceMetadata'] = [{k: s.get(k) for k in ('id', 'version', 'sha256', 'modifiedTime', 'size', 'mimeType')} for s in sources]
        return attach_reconciliation_context(context, sources, fragments)

    def context(self, c, user, product, snapshot, job, requested_evidence=None):
        from .product_reasoning_continuity import restore_plan
        raw = self._context_raw(c, user, product, snapshot, job, requested_evidence)
        from .product_reasoning_refresh import select_refresh_plan
        refreshed = select_refresh_plan(self, c, user, product, snapshot, job, raw)
        if refreshed.get('_continuity'): return refreshed
        return restore_plan(c, user, product, snapshot, raw,
            lambda before, requested: self._context_raw(c, user, before, snapshot, job, requested))

    def enqueue(self, c, user, product, snapshot, job=None, *, retry=False, acknowledge_unknown=False,
                expected_id=None):
        require_access(c, user)
        job = job or latest_job(c, user, product)
        if not eligible_job(job):
            if expected_id:
                fail('reasoning_context_changed', 'Los materiales de esta ficha cambiaron. Actualiza el resumen antes de continuar.', 409)
            return None
        try:
            material_id = UUID(str(job['id']))
        except (ValueError, TypeError):
            if expected_id:
                fail('reasoning_context_changed', 'Los materiales de esta ficha cambiaron. Actualiza el resumen antes de continuar.', 409)
            return None
        if not belongs_to_product(c, user, product, material_id):
            if expected_id:
                fail('reasoning_context_changed', 'Los materiales de esta ficha cambiaron. Actualiza el resumen antes de continuar.', 409)
            return None
        # Scope selection and context construction are local. Credentials refresh occurs only in worker.
        context = self.context(c, user, product, snapshot, job)
        if not context.get('targets') and not context.get('_continuity'):
            if expected_id:
                fail('reasoning_context_changed', 'La ficha ya no necesita esta comprobación. Actualiza el resumen.', 409)
            return None
        from .product_reasoning_continuity import select_plan, initial_result
        # Reusing a paid result still requires locally valid connection permissions.
        connection_error = None
        credentials = None
        try:
            credentials = self.materials.credentials(c, user, refresh=False)
        except (HTTPException, CloudError) as error:
            detail = error.detail if isinstance(error, HTTPException) and isinstance(error.detail, dict) else {}
            connection_error = {'error': detail.get('error', 'connection_unavailable'),
                'connectionMessage': detail.get('message', 'Renueva la conexión de Google Drive y Google Cloud con Uony para continuar. Tus datos se conservan.'),
                'connectionActions': detail.get('connectionActions', [])}
            context = self._context_raw(c, user, product, snapshot, job)
            context['fingerprint'] = digest({'context': context['fingerprint'], 'connectionUnavailable': connection_error['error']})
        if not connection_error:
            context = select_plan(c, user, product, snapshot, context,
                lambda before, requested: self._context_raw(c, user, before, snapshot, job, requested),
                lambda before, requested: self.context(c, user, before, snapshot, job, requested))
            context['_billingProjectId'] = credentials[1][0]['project_id']
        signature = product_signature(product)
        material_sig = material_signature(job)
        if expected_id:
            prior = c.execute('''SELECT * FROM product_reasoning_jobs
                WHERE user_id=%s AND product_id=%s
                ORDER BY coalesce((revision=%s OR applied_revision=%s),false) DESC,
                    updated_at DESC,created_at DESC,id DESC LIMIT 1 FOR UPDATE''',
                (user['id'], product['id'], product['revision'], product['revision'])).fetchone()
        else:
            prior = c.execute("SELECT * FROM product_reasoning_jobs WHERE user_id=%s AND product_id=%s ORDER BY updated_at DESC,created_at DESC,id DESC LIMIT 1 FOR UPDATE", (user['id'], product['id'])).fetchone()
        same_prior = bool(prior and (prior['output_signature'] or prior['product_signature']) == signature
            and prior['schema_hash'] == snapshot['metadata']['schemaHash']
            and prior['context'].get('_materialSignature') == material_sig
            and prior['google_subject'] == user['google_subject']
            and prior['context'].get('_billingProjectId') == context.get('_billingProjectId')
            and context['fingerprint'] in (prior['context']['fingerprint'], prior['result'].get('outputContextFingerprint')))
        # A connection failure created the job from the raw context with a
        # connectionUnavailable marker. Once access is restored, the normal
        # context has a different fingerprint; permit only this exact transition
        # on the same explicitly selected, unpaid job.
        connection_recovery = False
        if expected_id and not same_prior and not connection_error and prior and prior['id'] == expected_id:
            raw = self._context_raw(c, user, product, snapshot, job)
            old_error = prior['result'].get('error')
            connection_recovery = bool(prior['status'] == 'error'
                and prior['result'].get('connectionMessage') and old_error
                and prior['material_job_id'] == material_id
                and (prior['output_signature'] or prior['product_signature']) == signature
                and prior['schema_hash'] == snapshot['metadata']['schemaHash']
                and prior['google_subject'] == user['google_subject']
                and prior['context'].get('_materialSignature') == material_sig
                and prior['context']['fingerprint'] == digest({
                    'context': raw['fingerprint'], 'connectionUnavailable': old_error}))
            same_prior = connection_recovery
        if expected_id and (not retry or not same_prior or prior['id'] != expected_id
                            or prior['status'] not in ('error', 'unknown')
                            or prior['revision'] != product['revision']):
            fail('reasoning_context_changed', 'La comprobación cambió. Actualiza el resumen antes de volver a intentarlo.', 409)
        if same_prior:
            row = prior
        else:
            fingerprint = digest({'owner': str(user['id']), 'product': str(product['id']), 'google': user['google_subject'],
                'seller': snapshot['seller_id'], 'market': snapshot['marketplace_id'], 'type': snapshot['product_type'],
                'schema': snapshot['metadata']['schemaHash'], 'context': context['fingerprint'], 'signature': signature,
                'materials': material_sig, 'billingProject': context.get('_billingProjectId')})
            row = c.execute("SELECT * FROM product_reasoning_jobs WHERE user_id=%s AND product_id=%s AND fingerprint=%s FOR UPDATE", (user['id'], product['id'], fingerprint)).fetchone()
            if row is None:
                result = connection_error or initial_result(context)
                complete = bool(result) and not context['targets'] and not context['coverage'].get('omittedTargets')
                if complete:
                    result['outputContextFingerprint'] = context['fingerprint']
                row = c.execute("""INSERT INTO product_reasoning_jobs(id,user_id,product_id,material_job_id,google_subject,
                    fingerprint,product_signature,schema_hash,status,revision,context,result,output_signature,applied_revision)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT(user_id,product_id,fingerprint) DO UPDATE SET fingerprint=excluded.fingerprint RETURNING *""",
                    (uuid4(), user['id'], product['id'], job['id'], user['google_subject'], fingerprint, signature,
                     snapshot['metadata']['schemaHash'], 'error' if connection_error else 'completed' if complete else 'queued', product['revision'],
                     Jsonb(context), Jsonb(result), signature if complete else None, product['revision'] if complete else None)).fetchone()
        if connection_error: return row
        unknown = c.execute('''SELECT call.id FROM product_reasoning_calls call JOIN product_reasoning_jobs job ON job.id=call.job_id
            WHERE job.user_id=%s AND job.product_id=%s AND (call.state='unknown' OR coalesce((call.usage->>'unconfirmedCalls')::integer,0)>0) AND call.acknowledged_at IS NULL LIMIT 1''',
            (user['id'], product['id'])).fetchone()
        if unknown and context.get('targets') and row['status'] == 'queued':
            row = c.execute("UPDATE product_reasoning_jobs SET status='unknown',result=result || %s,updated_at=now() WHERE id=%s RETURNING *",
                (Jsonb({'error': 'consumption_unknown'}), row['id'])).fetchone()
        if retry and row['status'] in ('error', 'unknown', 'stale'):
            if row['result'].get('error') == 'source_changed':
                fail('reasoning_sources_changed', 'Un archivo cambió. Actualiza primero el análisis de los materiales para usar su nueva versión.', 409)
            if blocked_retry(row['result']):
                if row['result'].get('error') == 'response_repair_required':
                    fail('reasoning_repair_required', 'Esta comprobación necesita una corrección antes de continuar. Tus datos están guardados.', 409)
                fail('reasoning_budget_exhausted', 'Esta comprobación alcanzó su límite. Conservamos el avance; necesitamos ampliar su capacidad antes de continuar.', 409)
            if unknown and not acknowledge_unknown:
                fail('reasoning_consumption_unknown', unknown_consumption_message(self.queue.usage(c, row['id'])), 409)
            if unknown:
                c.execute("""UPDATE product_reasoning_calls call SET acknowledged_at=now() FROM product_reasoning_jobs job
                    WHERE job.id=call.job_id AND job.user_id=%s AND job.product_id=%s
                    AND (call.state='unknown' OR coalesce((call.usage->>'unconfirmedCalls')::integer,0)>0) AND call.acknowledged_at IS NULL""", (user['id'], product['id']))
            row = c.execute("""UPDATE product_reasoning_jobs SET status='queued',revision=%s,lease_token=NULL,lease_until=NULL,
                context=%s,result=%s,updated_at=now() WHERE id=%s RETURNING *""",
                (product['revision'], Jsonb(context if connection_recovery else row['context']),
                 Jsonb(initial_result(context) if connection_recovery else
                       {k: v for k, v in row['result'].items()
                        if k not in ('error', 'connectionMessage', 'connectionActions')}),
                 row['id'])).fetchone()
        elif prior and row['id'] != prior['id']:
            row = c.execute('UPDATE product_reasoning_jobs SET updated_at=now() WHERE id=%s RETURNING *', (row['id'],)).fetchone()
        return row

    def decorate(self, c, user, product, snapshot, evaluation):
        # A user's final answer can complete the current schema after an earlier
        # reasoning job. Its historical fingerprint must not reopen a finished form.
        # Account/schema freshness has already been checked by ProductRequirements.
        if evaluation['state'] == 'locally_valid':
            return evaluation
        from .product_reasoning_context import targets_for
        from .product_requirements_mapping import scope_attributes
        targets, _, _ = targets_for(snapshot['schema'], scope_attributes(product.get('amazonAttributes', {}), snapshot['marketplace_id']), snapshot['marketplace_id'])
        if not targets:
            # Existing invalid values need a correction, not a job which is forbidden
            # to overwrite them. Unsupported schema issues retain needs_review.
            return evaluation
        job = latest_job(c, user, product)
        if job and not eligible_job(job):
            evaluation['reasoning'] = {'id': job['id'], 'status': 'running' if job.get('status') in ('queued', 'running') else 'stale',
                'message': 'Espera a que termine la lectura de tus materiales o reanuda el análisis pendiente. Tus datos se conservan.',
                'canRetry': False, 'requiresConsumptionAcknowledgement': False, 'materialsPending': True}
            evaluation.update(state='reasoning', fields=[], message=evaluation['reasoning']['message'])
            return evaluation
        signature = product_signature(product)
        row = c.execute("""SELECT * FROM product_reasoning_jobs WHERE user_id=%s AND product_id=%s
            ORDER BY (product_signature=%s OR output_signature=%s) DESC NULLS LAST,updated_at DESC,created_at DESC LIMIT 1""",
            (user['id'], product['id'], signature, signature)).fetchone()
        if not row:
            if eligible_job(job) and targets:
                evaluation['reasoning'] = {'id': None, 'status': 'stale', 'requiresPreparation': True, 'canRetry': True,
                    'requiresConsumptionAcknowledgement': False,
                    'message': 'Revisa tus documentos e imágenes con Uony antes de completar los datos pendientes.'}
                evaluation.update(state='reasoning', fields=[], message=evaluation['reasoning']['message'])
            return evaluation
        status = row['status']
        from .product_reasoning_continuity import reviewed, scope_matches
        if status == 'completed' and not reviewed(row): status = 'stale'
        if (row['google_subject'] != user['google_subject'] or row['schema_hash'] != snapshot['metadata']['schemaHash']
            or product_signature(product) not in (row['product_signature'], row['output_signature'])
            or not scope_matches(row['context'], snapshot)
            or row['context'].get('_policy', policy()) != policy()
            or not eligible_job(job) or material_signature(job) != row['context'].get('_materialSignature')):
            status = 'stale'
        usage = self.queue.usage(c, row['id'])
        evaluation['reasoning'] = {'id': str(row['id']), 'status': status, 'message': MESSAGES[status],
            'usage': usage, 'canRetry': status in ('error', 'unknown', 'stale'),
            'requiresConsumptionAcknowledgement': status == 'unknown'}
        if status == 'unknown' and row['result'].get('error') == 'consumption_unknown':
            evaluation['reasoning']['message'] = unknown_consumption_message(usage)
        if row['result'].get('connectionMessage') and status == 'error':
            evaluation['reasoning']['message'] = row['result']['connectionMessage']
            evaluation['connectionActions'] = row['result'].get('connectionActions', [])
        if row['result'].get('error') == 'source_changed' and status == 'stale':
            evaluation['reasoning'].update(canRetry=False, materialsPending=True,
                message='Un archivo cambió. Actualiza el análisis de tus materiales antes de continuar; los datos confirmados se conservan.')
        if blocked_retry(row['result']) and status == 'error':
            message = ('No se pudo terminar de contrastar toda la información. Tus datos están guardados; necesitamos completar esta comprobación antes de preguntarte.'
                       if row['result']['error'] in ('evidence_incomplete', 'response_incomplete', 'verification_rejected', 'response_repair_required') else
                       'La comprobación alcanzó su límite de trabajo. Conservamos el avance; falta ampliar su capacidad para terminarla.')
            evaluation['reasoning'].update(canRetry=False, message=message)
        if status != 'completed':
            evaluation.update(state='reasoning', fields=[], message=evaluation['reasoning']['message'])
        return evaluation

    def run(self, row):
        from .product_reasoning_worker import run
        return run(self, row)
