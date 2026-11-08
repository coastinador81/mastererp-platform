"""Admit an explicit customer instruction to the existing material queue.

The model cannot manufacture authorization: the exact message must already be
persisted in this owner's conversation. Folder/action interpretation belongs to
the caller; this boundary verifies the owner, resource and causal receipt.
"""
from hashlib import sha256
from uuid import UUID, uuid4

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from .google_drive_provider import FOLDER, file_id
from .product_materials_analyzer import ANALYSIS_EFFORT, ANALYSIS_MODEL
from .products import fail, require_access


def _receipt(c, user, row, request_id, thread_id, instruction_text,
             assignment_id):
    c.execute('''INSERT INTO product_material_job_authorizations
        (user_id,job_id,origin_request_id,google_subject,product_id,intake_id,
         revision,folder_id,project_id,assignment_id,action,source,
         conversation_request_id,conversation_thread_id,instruction_text,
         instruction_sha256,accepted_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'start','chat_instruction',
               %s,%s,%s,%s,now())''',
        (user['id'], row['id'], request_id, user['google_subject'],
         row['product_id'], row['intake_id'], row['revision'], row['folder_id'],
         row['project_id'], assignment_id, request_id, thread_id,
         instruction_text, sha256(instruction_text.encode('utf-8')).hexdigest()))


def _same_instruction(c, user, row, thread_id, folder_id, instruction_text):
    receipt = c.execute('''SELECT source,conversation_thread_id,instruction_text,
        instruction_sha256 FROM product_material_job_authorizations
        WHERE user_id=%s AND job_id=%s''', (user['id'], row['id'])).fetchone()
    return bool(receipt and receipt['source'] == 'chat_instruction'
        and receipt['conversation_thread_id'] == thread_id
        and receipt['instruction_text'] == instruction_text
        and receipt['instruction_sha256'] == sha256(instruction_text.encode()).hexdigest()
        and row['folder_id'] == folder_id
        and row['google_subject'] == user['google_subject'])


def _assignment(c, user, thread_id, assignment_id):
    if assignment_id is None:
        return None
    try:
        identifier = UUID(str(assignment_id))
    except (ValueError, TypeError):
        fail('assignment_not_found', 'No encontramos este encargo en tu cuenta.', 404)
    focus = c.execute('''SELECT assignment_id FROM uony_assignment_focus
        WHERE user_id=%s AND thread_id=%s AND google_subject=%s''',
        (user['id'], thread_id, user['google_subject'])).fetchone()
    if not focus or focus['assignment_id'] != identifier:
        fail('assignment_focus_conflict',
             'El encargo seleccionado cambió. Indica a Uony cuál quieres analizar.', 409)
    row = c.execute('''SELECT * FROM uony_assignments WHERE user_id=%s
        AND id=%s AND google_subject=%s FOR UPDATE''',
        (user['id'], identifier, user['google_subject'])).fetchone()
    if not row:
        fail('assignment_not_found', 'No encontramos este encargo en tu cuenta.', 404)
    return row


def _intake(c, user, thread_id, folder_id, folder_name, request_id, assignment):
    if assignment and assignment['intake_id']:
        row = c.execute('''SELECT * FROM uony_product_intakes WHERE user_id=%s
            AND id=%s AND google_subject=%s FOR UPDATE''',
            (user['id'], assignment['intake_id'], user['google_subject'])).fetchone()
    elif assignment:
        # A selection elsewhere in the thread is not this goal's selection.
        # The assignment must be linked explicitly before it can use it.
        active = c.execute('''SELECT id FROM uony_product_intakes WHERE user_id=%s
            AND thread_id=%s AND google_subject=%s
            AND status IN ('selecting','identified') LIMIT 1''',
            (user['id'], thread_id, user['google_subject'])).fetchone()
        if active:
            fail('intake_assignment_ambiguous',
                 'Hay otra carpeta preparada. Indica a qué encargo corresponde.', 409)
        row = None
    else:
        # A named folder is its own analysis scope. An earlier identified
        # folder in this conversation must not block or be overwritten by a
        # later, equally explicit instruction for another folder.
        row = c.execute('''SELECT i.* FROM uony_product_intakes i WHERE i.user_id=%s
            AND i.thread_id=%s AND i.google_subject=%s AND i.status='identified'
            AND i.folder_id=%s AND NOT EXISTS (
                SELECT 1 FROM uony_assignments a WHERE a.user_id=i.user_id
                AND a.intake_id=i.id)
            ORDER BY i.created_at DESC,i.id DESC LIMIT 1 FOR UPDATE''',
            (user['id'], thread_id, user['google_subject'], folder_id)).fetchone()
        if row is None:
            row = c.execute('''SELECT i.* FROM uony_product_intakes i WHERE i.user_id=%s
                AND i.thread_id=%s AND i.google_subject=%s AND i.status='selecting'
                AND NOT EXISTS (SELECT 1 FROM uony_assignments a
                    WHERE a.user_id=i.user_id AND a.intake_id=i.id)
                ORDER BY i.created_at DESC,i.id DESC LIMIT 1 FOR UPDATE''',
                (user['id'], thread_id, user['google_subject'])).fetchone()
    if row and row['status'] == 'linked':
        if row['folder_id'] != folder_id:
            fail('intake_folder_conflict',
                 'La preparación ya está vinculada a otra carpeta.', 409)
        return row
    if row and row['status'] == 'identified' and row['folder_id'] == folder_id:
        return row
    if row and row['status'] == 'identified':
        fail('intake_folder_conflict',
             'Ya hay otra carpeta preparada en esta conversación. Indica el encargo correspondiente antes de analizar.', 409)
    if row and row['status'] not in ('selecting', 'identified'):
        fail('intake_conflict', 'La selección de materiales cambió.', 409)
    if row:
        return c.execute('''UPDATE uony_product_intakes SET folder_id=%s,
            folder_metadata=%s,status='identified',revision=revision+1,updated_at=now()
            WHERE user_id=%s AND id=%s RETURNING *''',
            (folder_id, Jsonb({'id': folder_id, 'name': folder_name}),
             user['id'], row['id'])).fetchone()
    return c.execute('''INSERT INTO uony_product_intakes
        (user_id,id,thread_id,google_subject,origin_request_id,revision,
         status,folder_id,folder_metadata)
        VALUES(%s,%s,%s,%s,%s,1,'identified',%s,%s) RETURNING *''',
        (user['id'], uuid4(), thread_id, user['google_subject'], request_id,
         folder_id, Jsonb({'id': folder_id, 'name': folder_name}))).fetchone()


def _linked_job(c, user, row, assignment_id):
    if assignment_id is None:
        return
    link = c.execute('''SELECT assignment_id FROM uony_assignment_material_jobs
        WHERE user_id=%s AND material_job_id=%s''',
        (user['id'], row['id'])).fetchone()
    if not link or link['assignment_id'] != assignment_id:
        fail('assignment_material_existing',
             'Ya existe un análisis de esta carpeta. Revisa ese trabajo antes de iniciar otro.', 409)


def start_for_instruction(service, c, user, thread_id, folder_id, request_id,
                          instruction_text, *, assignment_id=None):
    from .product_materials import public_job

    require_access(c, user)
    current = c.execute('SELECT * FROM users WHERE id=%s FOR UPDATE',
                        (user['id'],)).fetchone()
    if not current or current['google_subject'] != user['google_subject']:
        fail('account_changed', 'La cuenta cambió. Vuelve a abrir la conversación.', 409)
    user = current
    try:
        request_id = UUID(str(request_id))
        folder_id = file_id(folder_id)
    except (ValueError, TypeError):
        fail('invalid_instruction', 'No pudimos comprobar esta solicitud.', 422)
    if (not isinstance(thread_id, str) or not thread_id or len(thread_id) > 80
            or not isinstance(instruction_text, str)
            or not 1 <= len(instruction_text.strip()) <= 3000):
        fail('invalid_instruction', 'No pudimos comprobar esta solicitud.', 422)
    thread = c.execute('''SELECT deleted_at FROM uony_threads
        WHERE user_id=%s AND id=%s''', (user['id'], thread_id)).fetchone()
    message = c.execute('''SELECT thread_id,prompt FROM uony_requests
        WHERE user_id=%s AND request_id=%s''', (user['id'], request_id)).fetchone()
    if (not thread or thread['deleted_at'] or not message
            or message['thread_id'] != thread_id
            or message['prompt'] != instruction_text):
        fail('instruction_not_confirmed',
             'La orden no coincide con un mensaje tuyo guardado en esta conversación.', 409)

    previous = c.execute('''SELECT * FROM product_material_jobs
        WHERE user_id=%s AND request_id=%s''', (user['id'], request_id)).fetchone()
    if previous:
        if not _same_instruction(c, user, previous, thread_id, folder_id,
                                 instruction_text):
            fail('materials_conflict', 'Esta solicitud corresponde a otra acción o carpeta.', 409)
        _linked_job(c, user, previous, UUID(str(assignment_id)) if assignment_id else None)
        return {'job': service.view(c, previous, _sku(c, user, previous)),
                'reused': True, 'intakeId': str(previous['intake_id']) if previous['intake_id'] else None}

    assignment = _assignment(c, user, thread_id, assignment_id)
    drive_connection, cloud_connection = service.credentials(c, user, refresh=True)
    item = service.drive.metadata(drive_connection[1], folder_id)
    name = item.get('name')
    if (item.get('id') != folder_id or item.get('mimeType') != FOLDER
            or item.get('trashed') or not isinstance(name, str)
            or not name.strip() or len(name.strip()) > 500
            or any(ord(char) < 32 for char in name)):
        fail('invalid_folder', 'Indica una carpeta de Drive a la que tengas acceso.', 409)

    # An already identified product remains the action anchor; an intake is
    # needed only while the customer has not created a product/SKU yet.
    linked_intake = None
    product_id = assignment['product_id'] if assignment else None
    if assignment and assignment['intake_id']:
        linked_intake = c.execute('''SELECT * FROM uony_product_intakes WHERE user_id=%s
            AND id=%s AND google_subject=%s FOR UPDATE''',
            (user['id'], assignment['intake_id'], user['google_subject'])).fetchone()
        if not linked_intake:
            fail('intake_not_found', 'La preparación de este encargo ya no está disponible.', 409)
        if linked_intake['status'] == 'linked':
            if product_id and product_id != linked_intake['product_id']:
                fail('assignment_product_conflict', 'La preparación pertenece a otra ficha.', 409)
            product_id = linked_intake['product_id']
    intake = None if product_id else _intake(c, user, thread_id, folder_id,
                                             name.strip(), request_id, assignment)
    product_id = product_id or (intake['product_id'] if intake else None)
    product = None
    if product_id:
        product = c.execute('''SELECT id,sku,revision FROM products WHERE user_id=%s
            AND id=%s AND deleted_at IS NULL FOR UPDATE''',
            (user['id'], product_id)).fetchone()
        if not product:
            fail('product_not_found', 'La ficha de este encargo ya no está disponible.', 409)
    # Sharing a Drive folder with another product is not a product selection.
    # Only this goal's explicit product/intake binding may supply a ficha.
    if assignment and assignment['product_id'] and product['id'] != assignment['product_id']:
        fail('assignment_product_conflict', 'La carpeta pertenece a otra ficha.', 409)
    anchor_product = product['id'] if product else None
    anchor_intake = None if product else intake['id']
    revision = product['revision'] if product else intake['revision']
    matching = c.execute('''SELECT * FROM product_material_jobs WHERE user_id=%s
        AND google_subject=%s AND project_id=%s AND folder_id=%s
        AND product_id IS NOT DISTINCT FROM %s::uuid
        AND intake_id IS NOT DISTINCT FROM %s::uuid
        AND coalesce(result->>'requestedRevision',revision::text)=%s
        ORDER BY created_at DESC,id DESC LIMIT 1''',
        (user['id'], user['google_subject'], cloud_connection[0]['project_id'], folder_id,
         anchor_product, anchor_intake, str(revision))).fetchone()
    if matching:
        _linked_job(c, user, matching, assignment['id'] if assignment else None)
        return {'job': service.view(c, matching, product['sku'] if product else None),
                'reused': True, 'intakeId': str(anchor_intake) if anchor_intake else None}
    if c.execute('''SELECT 1 FROM product_material_calls calls
        JOIN product_material_jobs jobs ON jobs.id=calls.job_id
        WHERE jobs.user_id=%s AND calls.state='unknown'
        AND calls.acknowledged_at IS NULL LIMIT 1''',
        (user['id'],)).fetchone():
        fail('materials_consumption_unknown',
             'Revisa el consumo incierto del análisis anterior antes de iniciar otro.', 409)
    if c.execute('''SELECT 1 FROM product_material_jobs WHERE user_id=%s
        AND status IN ('queued','running') LIMIT 1''', (user['id'],)).fetchone():
        fail('materials_running', 'Ya hay un análisis en curso en tu cuenta.', 409)
    daily = c.execute('''SELECT count(*) AS n FROM product_material_jobs WHERE user_id=%s
        AND created_at>now()-interval '24 hours' ''', (user['id'],)).fetchone()['n']
    if daily >= 10:
        fail('materials_daily_limit', 'Has alcanzado el límite de 10 análisis en 24 horas.', 429)
    engine = 'adk' if service.engine_enabled_for(user['id'], 'adk') else 'classic'
    row = c.execute('''INSERT INTO product_material_jobs
        (id,user_id,product_id,intake_id,request_id,google_subject,revision,
         folder_id,engine,project_id,status,result)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'queued',%s) RETURNING *''',
        (uuid4(), user['id'], anchor_product, anchor_intake, request_id,
         user['google_subject'], revision, folder_id, engine,
         cloud_connection[0]['project_id'], Jsonb({
             'protocolVersion': 2, 'requestedRevision': revision,
             'requestedReanalysisOf': None, 'folderName': name.strip(),
             'processed': 0, 'total': 0, 'sources': [], 'proposals': [],
             'warnings': [], 'analysisModel': ANALYSIS_MODEL,
             'analysisEffort': ANALYSIS_EFFORT,
             'usage': {'calls': 0, 'totalTokenCount': 0}, 'stage': 'queued'}))).fetchone()
    _receipt(c, user, row, request_id, thread_id, instruction_text,
             assignment['id'] if assignment else None)
    if assignment:
        c.execute('''INSERT INTO uony_assignment_material_jobs
            (user_id,assignment_id,google_subject,product_id,intake_id,
             material_job_id,origin_request_id)
            VALUES(%s,%s,%s,%s,%s,%s,%s)''',
            (user['id'], assignment['id'], user['google_subject'],
             anchor_product, anchor_intake, row['id'], request_id))
        if anchor_intake and assignment['intake_id'] is None:
            c.execute('''UPDATE uony_assignments SET intake_id=%s,
                version=version+1,updated_at=now()
                WHERE user_id=%s AND id=%s''',
                (anchor_intake, user['id'], assignment['id']))
    return {'job': public_job(row, product['sku'] if product else None),
            'reused': False, 'intakeId': str(anchor_intake) if anchor_intake else None}


def _sku(c, user, row):
    if not row['product_id']:
        return None
    product = c.execute('''SELECT sku FROM products WHERE user_id=%s AND id=%s
        AND deleted_at IS NULL''', (user['id'], row['product_id'])).fetchone()
    return product['sku'] if product else None


def get_instruction_job(service, c, user, job_id):
    require_access(c, user)
    try:
        job_id = UUID(str(job_id))
    except (ValueError, TypeError):
        fail('materials_not_found', 'No se encuentra este análisis.', 404)
    row = c.execute('''SELECT * FROM product_material_jobs WHERE id=%s
        AND user_id=%s AND google_subject=%s''',
        (job_id, user['id'], user['google_subject'])).fetchone()
    if not row:
        fail('materials_not_found', 'No se encuentra este análisis.', 404)
    return {'job': service.view(c, row, _sku(c, user, row)),
            'intakeId': str(row['intake_id']) if row['intake_id'] else None}
