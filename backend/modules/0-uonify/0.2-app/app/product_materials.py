"""Trabajos de materiales por propietario, identidad Google y revisión de producto."""
from uuid import UUID, uuid4
from time import monotonic
import hashlib
from fastapi import HTTPException
from cryptography.fernet import Fernet
from psycopg.types.json import Jsonb
from .google_account import require_same_connection
from .google_cloud_provider import CloudError
from .google_drive_provider import file_id
from .products import find, fail, require_access
from .product_materials_analyzer import MaterialsAnalyzer, ANALYSIS_MODEL, ANALYSIS_EFFORT
from .product_materials_consent import (
    start_consent, record_start_consent, require_exact_start_replay,
)
from .product_materials_queue import MaterialsQueue, LeaseLost, merge_proposals

MESSAGES = {
    'google_unavailable': 'No se pudo completar el acceso a Google. Los resultados previos se conservan; puedes reintentar.',
    'permission_denied': 'Google no permite leer uno de los recursos. Revisa los permisos de la cuenta conectada.',
    'reauthorize': 'Vuelve a conectar Google para renovar el permiso y reintenta el análisis.',
    'quota_exceeded': 'El proyecto de Google ha alcanzado su cuota. Se conservan las fuentes ya revisadas.',
    'invalid_response': 'El análisis no devolvió evidencia válida. Puedes reintentar conservando los originales.',
    'analysis_timeout': 'Google tardó demasiado en responder al análisis. Los resultados guardados se conservan; puedes reintentar sin repetir las fuentes ya analizadas.',
    'analysis_request_invalid': 'Google ha rechazado el formato de la solicitud de análisis. Los archivos y los resultados guardados se conservan; es necesario revisar la configuración del análisis antes de reintentar.',
    'file_too_large': 'El archivo supera 64 MiB. Aporta un derivado para análisis; el original se conserva en Drive.',
    'invalid_file': 'La carpeta o el archivo ya no están disponibles.',
    'rate_limited': 'Google Drive está limitando las consultas. Los resultados se conservan; reintenta en unos segundos.',
    'file_forbidden': 'El propietario o tu organización no permiten descargar uno de los archivos. El resto se conserva.',
    'google_changed': 'El proyecto de Google cambió durante el análisis. Los resultados se conservan; inicia uno nuevo con la conexión actual.',
}


def public_job(row, sku):
    result = row['result']
    return {**result, 'id': str(row['id']), 'sku': sku, 'revision': row['revision'],
            **({'intakeId': str(row['intake_id'])} if row.get('intake_id') else {}),
            'folderId': row['folder_id'], 'status': row['status'],
            'canResume': (row['status'] in ('paused', 'error') and result.get('protocolVersion') == 2
                          and result.get('pauseReason') not in ('source_changed', 'engine_unavailable', 'project_unpinned', 'budget_exhausted')
                          and (result.get('error') or {}).get('code') != 'google_changed'),
            'pauseRequested': row.get('pause_requested', False),
            'createdAt': row['created_at'].isoformat(), 'updatedAt': row['updated_at'].isoformat()}


class ProductMaterials:
    def __init__(self, settings, database, drive, cloud, analyzer=None, *, adk_analyzer=None):
        self.settings, self.database, self.drive, self.cloud = settings, database, drive, cloud
        self.cipher = Fernet(settings.encryption_key)
        self.analyzer = analyzer or MaterialsAnalyzer()
        self.adk_analyzer = adk_analyzer
        self._tokens = {}
        self.available_engines = ('classic', 'adk') if adk_analyzer is not None else ('classic',)
        self.queue = MaterialsQueue(database, self.available_engines)

    def analyzer_for(self, engine):
        if engine == 'classic':
            return self.analyzer
        if engine == 'adk' and self.adk_analyzer is not None:
            return self.adk_analyzer
        raise CloudError('engine_unavailable')

    def engine_enabled_for(self, user_id, engine):
        if engine == 'classic':
            return True
        return (engine == 'adk' and self.adk_analyzer is not None and
                str(user_id) in getattr(self.settings, 'material_adk_pilot_user_ids', ()))

    def credentials(self, c, user, refresh=True, expected_project_id=None):
        rows = []
        for table, provider, label, key in [('google_drive_connections', self.drive, 'Google Drive', 'drive'),
                                       ('google_cloud_connections', self.cloud, 'Google Cloud', 'cloud')]:
            row = c.execute('SELECT * FROM ' + table + ' WHERE user_id=%s', (user['id'],)).fetchone()
            try:
                if not row:
                    fail('not_connected', 'Conecta ' + label + ' desde esta conversación para analizar los archivos.', 409)
                require_same_connection(user, row)
                if row['status'] != 'connected':
                    fail('reauthorize', 'Renueva la conexión de ' + label + ' para continuar.', 409)
                if table == 'google_cloud_connections' and expected_project_id is not None and row['project_id'] != expected_project_id:
                    raise CloudError('google_changed')
            except HTTPException as error:
                error.detail['connectionActions'] = [{'provider': key, 'action': 'manage'}]
                raise
            token = None
            if refresh:
                cache_key = (str(user['id']), table, hashlib.sha256(row['refresh_encrypted'].encode()).hexdigest())
                cached = self._tokens.get(cache_key)
                if cached and cached[0] > monotonic():
                    token = cached[1]
                else:
                    token = provider.refresh(self.cipher.decrypt(row['refresh_encrypted'].encode()).decode())
                    if len(self._tokens) >= 256:
                        self._tokens.clear()
                    self._tokens[cache_key] = (monotonic() + 240, token)
            rows.append((row, token))
        if not rows[1][0].get('project_id') or not (rows[1][0].get('project_check') or {}).get('ready'):
            raise HTTPException(409, detail={'error': 'project_required', 'message': 'Selecciona un proyecto de Google Cloud disponible para Uony.',
                                            'connectionActions': [{'provider': 'cloud', 'action': 'manage'}]})
        return rows

    def start(self, c, user, sku, revision, folder_id, request_id, reanalysis_of=None,
              *, consent_version=None, consent_text=None, consent_sha256=None,
              assignment_id=None):
        require_access(c, user)
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user['id'],))
        product = find(c, user, sku)
        product = c.execute('SELECT * FROM products WHERE user_id=%s AND id=%s AND deleted_at IS NULL FOR UPDATE',
                            (user['id'], product['id'])).fetchone()
        file_id(folder_id)
        request_id = UUID(str(request_id))
        reanalysis_of = UUID(str(reanalysis_of)) if reanalysis_of else None
        previous = c.execute('SELECT * FROM product_material_jobs WHERE user_id=%s AND request_id=%s', (user['id'], request_id)).fetchone()
        if previous:
            if (previous['product_id'] != product['id'] or previous['google_subject'] != user['google_subject']
                    or previous['result'].get('requestedRevision', previous['revision']) != revision or previous['folder_id'] != folder_id
                    or previous['result'].get('requestedReanalysisOf') != (str(reanalysis_of) if reanalysis_of else None)):
                fail('materials_conflict', 'Esta solicitud corresponde a otra carpeta o revisión.', 409)
            require_exact_start_replay(c, user['id'], previous['id'],
                                       consent_version, consent_sha256, consent_text)
            return public_job(previous, product['sku'])
        # An old request may be reconciled after the UI copy changes. Its
        # existing receipt is never replaced by the caller's newer version.
        consent = start_consent(consent_version, consent_sha256, consent_text,
                                require_version=True)
        if product['revision'] != revision:
            fail('product_conflict', 'La ficha ha cambiado. Actualiza antes de analizar sus materiales.', 409)
        # The browser may lose its requestId after the response (or the whole tab) is lost.
        # Serialize on the account above, then deduplicate across the full job history:
        # a newer job for folder B must not turn a late retry of folder A into another paid job.
        latest = c.execute('''SELECT * FROM product_material_jobs WHERE user_id=%s AND product_id=%s
            AND google_subject=%s ORDER BY created_at DESC,id DESC LIMIT 1''',
            (user['id'], product['id'], user['google_subject'])).fetchone()
        if reanalysis_of:
            if not latest or latest['id'] != reanalysis_of or latest['status'] in ('queued', 'running'):
                fail('materials_conflict', 'El análisis ha cambiado. Revisa su estado antes de iniciar uno nuevo.', 409)
        else:
            matching = c.execute('''SELECT * FROM product_material_jobs WHERE user_id=%s AND product_id=%s
                AND google_subject=%s AND folder_id=%s
                AND COALESCE(result->>'requestedRevision', revision::text)=%s
                ORDER BY created_at DESC,id DESC LIMIT 1''',
                (user['id'], product['id'], user['google_subject'], folder_id, str(revision))).fetchone()
            if matching:
                return public_job(matching, product['sku'])
        if c.execute("""SELECT calls.id FROM product_material_calls AS calls
            JOIN product_material_jobs AS jobs ON jobs.id=calls.job_id
            WHERE jobs.user_id=%s AND calls.state='unknown'
            AND calls.acknowledged_at IS NULL LIMIT 1""", (user['id'],)).fetchone():
            fail('materials_consumption_unknown', 'Revisa el consumo incierto del análisis anterior antes de iniciar otro.', 409)
        cloud_connection = self.credentials(c, user, refresh=False)[1][0]
        engine = 'adk' if self.engine_enabled_for(user['id'], 'adk') else 'classic'
        running = c.execute("SELECT id FROM product_material_jobs WHERE user_id=%s AND status IN ('queued','running')", (user['id'],)).fetchone()
        if running:
            fail('materials_running', 'Ya hay un análisis en curso en tu cuenta. Espera a que termine antes de iniciar otro.', 409)
        daily = c.execute("SELECT count(*) AS count FROM product_material_jobs WHERE user_id=%s AND created_at>now()-interval '24 hours'", (user['id'],)).fetchone()['count']
        if daily >= 10:
            fail('materials_daily_limit', 'Has alcanzado el límite de 10 análisis en 24 horas. Los resultados guardados siguen disponibles.', 429)
        row = c.execute('''INSERT INTO product_material_jobs(id,user_id,product_id,request_id,google_subject,revision,folder_id,engine,project_id,status,result)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,'queued',%s) RETURNING *''',
            (uuid4(), user['id'], product['id'], request_id, user['google_subject'], revision, folder_id,
             engine, cloud_connection['project_id'],
             Jsonb({'protocolVersion': 2, 'requestedRevision': revision, 'requestedReanalysisOf': str(reanalysis_of) if reanalysis_of else None,
                    'folderName': '', 'processed': 0, 'total': 0, 'sources': [], 'proposals': [], 'warnings': [],
                    'analysisModel': ANALYSIS_MODEL, 'analysisEffort': ANALYSIS_EFFORT,
                    'usage': {'calls': 0, 'totalTokenCount': 0}, 'stage': 'queued'}))).fetchone()
        record_start_consent(c, row, consent, reanalysis_of, assignment_id=assignment_id)
        return public_job(row, product['sku'])

    def start_for_instruction(self, c, user, thread_id, folder_id, request_id,
                              instruction_text, *, assignment_id=None):
        """Admit one explicit customer instruction into the existing material queue.

        The caller resolves and checks the requested action/folder; this boundary
        verifies the persisted customer turn and account before spending anything.
        """
        from .product_materials_instruction import start_for_instruction
        return start_for_instruction(self, c, user, thread_id, folder_id,
                                     request_id, instruction_text,
                                     assignment_id=assignment_id)

    def get_instruction_job(self, c, user, job_id):
        """Read a chat-authorized analysis even when no product exists yet."""
        from .product_materials_instruction import get_instruction_job
        return get_instruction_job(self, c, user, job_id)

    def get_row(self, c, user, sku, job_id=None, *, include_linked_intake=False):
        product = find(c, user, sku)
        params = [user['id'], product['id'], user['google_subject']]
        where = ' AND id=%s' if job_id else ''
        if job_id:
            try:
                params.append(UUID(str(job_id)))
            except ValueError:
                fail('materials_not_found', 'No se encuentra este análisis.', 404)
        if include_linked_intake:
            # The immutable pre-product authorization remains anchored to its
            # intake. A later explicit product link grants read-only access to
            # the same dossier; it never relabels the original job or consent.
            params = [user['id'], user['google_subject'], product['id'], product['id']]
            if job_id:
                params.append(UUID(str(job_id)))
            row = c.execute('''SELECT j.* FROM product_material_jobs AS j
                LEFT JOIN uony_product_intakes AS i ON i.user_id=j.user_id
                    AND i.id=j.intake_id AND i.google_subject=j.google_subject
                WHERE j.user_id=%s AND j.google_subject=%s
                    AND (j.product_id=%s OR (i.product_id=%s AND i.status='linked'
                        AND i.folder_id=j.folder_id))'''
                + (' AND j.id=%s' if job_id else '')
                + ' ORDER BY j.created_at DESC,j.id DESC LIMIT 1', params).fetchone()
        else:
            row = c.execute('''SELECT * FROM product_material_jobs WHERE user_id=%s AND product_id=%s
                AND google_subject=%s''' + where + ' ORDER BY created_at DESC,id DESC LIMIT 1', params).fetchone()
        if job_id and not row:
            fail('materials_not_found', 'No se encuentra este análisis en tu producto.', 404)
        return row

    def get(self, c, user, sku, job_id=None):
        product = find(c, user, sku)
        row = self.get_row(c, user, sku, job_id, include_linked_intake=True)
        return {'job': self.view(c, row, product['sku']) if row else None,
                'product': {'sku': product['sku'], 'revision': product['revision']}}

    def view(self, c, row, sku):
        result = public_job(row, sku)
        if row['result'].get('protocolVersion') != 2:
            return result
        result['budget'] = self.queue.budget(c, row)
        result['usage'] = {'calls': result['budget']['usedCalls'], 'totalTokenCount': result['budget']['usedTokens']}
        if result['budget']['unknownCalls']:
            result['usage']['unconfirmedCalls'] = result['budget']['unknownCalls']
        sources = c.execute('SELECT data FROM product_material_sources WHERE job_id=%s ORDER BY source_id', (row['id'],)).fetchall()
        if sources:
            result['sources'] = [item['data'] for item in sources]
        counts = c.execute("""SELECT count(*) FILTER(WHERE state NOT IN ('superseded','split')) AS total,
            count(*) FILTER(WHERE state='done') AS done,
            count(*) FILTER(WHERE state IN ('pending','running','unknown','error')) AS pending,
            count(*) FILTER(WHERE state='partial') AS partial FROM product_material_fragments WHERE job_id=%s""", (row['id'],)).fetchone()
        source_values = [item['data'] for item in sources]
        from .product_materials_upgrade import upgrade_eligible, new_reader_work_conflict
        result['readerUpgradeAvailable'] = (row['status'] in ('ready', 'paused', 'error') and result.get('operation') not in ('upgrade_readers', 'repair_evidence')
                                            and result.get('pauseReason') != 'source_changed' and any(upgrade_eligible(source) for source in source_values)
                                            and new_reader_work_conflict(c, row, source_values) is None)
        result['coverage'] = {**result.get('coverage', {}), 'sourcesTotal': len(source_values),
            'sourcesRead': sum(bool(source.get('readComplete')) for source in source_values),
            'fragmentsTotal': counts['total'], 'fragmentsDone': counts['done'] + counts['partial'],
            'fragmentsPending': counts['pending'], 'fragmentsPartial': counts['partial']}
        from .product_materials_resolution import apply_resolution, minimal_fragments
        apply_resolution(result, minimal_fragments(c, row['id']))
        # New repairs remain closed until the quantified consent copy is approved.
        # Keep resolution issues visible, but never advertise a blocked action.
        result['repairAvailable'] = False
        if row['intake_id']:
            result.update(analysisScope='linked_intake' if sku else 'intake',
                          canResume=False, readerUpgradeAvailable=False)
        return result

    def update_proposals(self, c, user, sku, job_id, proposals):
        row = self.get_row(c, user, sku, job_id)
        row = c.execute('SELECT * FROM product_material_jobs WHERE id=%s FOR UPDATE', (row['id'],)).fetchone()
        merged = merge_proposals(proposals, row['result'].get('proposals', []))
        c.execute("UPDATE product_material_jobs SET result=jsonb_set(result,'{proposals}',%s),updated_at=now() WHERE id=%s AND user_id=%s",
                  (Jsonb(merged), row['id'], user['id']))

    def control(self, c, user, sku, job_id, action, revision, request_id, acknowledge_unknown=False):
        from .product_materials_controls import control
        return control(self, c, user, sku, job_id, action, revision, request_id, acknowledge_unknown)

    def reconcile(self, c, user, sku, job_id, revision, request_id):
        from .product_materials_reconcile import request_reconciliation
        return request_reconciliation(self, c, user, sku, job_id, revision, request_id)

    def upgrade_readers(self, c, user, sku, job_id, revision, request_id, acknowledge_unknown=False,
                        *, consent_version=None, consent_text=None, consent_sha256=None):
        from .product_materials_upgrade import request_upgrade
        return request_upgrade(self, c, user, sku, job_id, revision, request_id, acknowledge_unknown,
                               consent_version=consent_version, consent_text=consent_text,
                               consent_sha256=consent_sha256)

    def update_facts(self, c, user, sku, job_id, proposals):
        from .product_materials_reconcile import update_facts
        return update_facts(self, c, user, sku, job_id, proposals)

    def repair_evidence(self, c, user, sku, job_id, revision, request_id, acknowledge_unknown=False,
                        *, consent_version=None, consent_text=None, consent_sha256=None):
        from .product_materials_repair import request_repair
        return request_repair(self, c, user, sku, job_id, revision, request_id, acknowledge_unknown,
                              consent_version=consent_version, consent_text=consent_text,
                              consent_sha256=consent_sha256)

    def store(self, job_id, user_id, result, status='running', lease_token=None):
        if not lease_token:
            raise LeaseLost('A worker token is required to checkpoint an analysis')
        return self.queue.checkpoint(job_id, user_id, lease_token, result, status)

    def run(self, job_id, user_id, lease_token=None):
        from .product_materials_worker import run
        if not lease_token:
            with self.database.connect() as c:
                owner = c.execute('SELECT user_id FROM product_material_jobs WHERE id=%s AND user_id=%s', (job_id, user_id)).fetchone()
            if not owner:
                return
            row = self.queue.claim('explicit-run', job_id)
            if not row or str(row['user_id']) != str(user_id):
                return
            lease_token = row['lease_token']
        run(self, job_id, user_id, lease_token)

    def recover(self):
        return self.queue.recover()
