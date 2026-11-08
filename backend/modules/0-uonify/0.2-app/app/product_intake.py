"""Discover authorized materials before asking for a product name or SKU.

Only folder metadata is inspected here. Reading, analysis and provider generation
remain separate operations explicitly started by the customer.
"""
from hashlib import sha256
import json
from uuid import UUID, uuid4
from cryptography.fernet import Fernet
from fastapi import HTTPException
from psycopg.types.json import Jsonb
from .google_account import require_same_connection
from .google_cloud_provider import CloudError
from .google_drive_provider import FOLDER, file_id
from .products import fail, present, require_access, save
from .product_memory import bind as bind_product

DECLARATION = {
    'name': 'show_product_intake',
    'description': ('Permite seleccionar los materiales de un producto antes de pedir su nombre o SKU. '
                    'Muestra el selector de carpeta en esta conversación; no lee archivos, consume IA '
                    'ni crea un producto hasta que el cliente confirme. No exige que ya exista un borrador.'),
    'parameters': {'type': 'OBJECT', 'properties': {}},
}


def thread(c, user, thread_id):
    row = c.execute('SELECT * FROM uony_threads WHERE user_id=%s AND id=%s',
                    (user['id'], thread_id)).fetchone()
    if not row:
        fail('thread_not_found', 'No encontramos esta conversación en tu cuenta.', 404)
    if row.get('deleted_at'):
        fail('thread_deleted', 'Esta conversación se ha eliminado. Abre una nueva para continuar.', 410)
    return row


def lock_owner(c, user):
    current = c.execute('SELECT * FROM users WHERE id=%s FOR UPDATE', (user['id'],)).fetchone()
    if not current or current['google_subject'] != user['google_subject']:
        fail('account_changed', 'Tu cuenta ha cambiado. Vuelve a abrir la conversación.', 409)
    require_access(c, current)
    return current


def find(c, user, identifier, thread_id, lock=False):
    thread(c, user, thread_id)
    row = c.execute('SELECT * FROM uony_product_intakes WHERE user_id=%s AND id=%s AND thread_id=%s'
                    + (' FOR UPDATE' if lock else ''), (user['id'], identifier, thread_id)).fetchone()
    if not row or row['google_subject'] != user['google_subject']:
        fail('intake_not_found', 'No encontramos esta selección de materiales en tu conversación.', 404)
    return row


def product(c, user, row):
    if not row.get('product_id'):
        return None
    result = c.execute('SELECT * FROM products WHERE user_id=%s AND id=%s AND deleted_at IS NULL',
                       (user['id'], row['product_id'])).fetchone()
    if not result:
        fail('intake_product_deleted', 'El producto asociado se ha eliminado. Inicia una nueva selección con Uony.', 410)
    return present(result)


def dto(c, user, row, changes=False):
    result = {'id': str(row['id']), 'threadId': row['thread_id'], 'revision': row['revision'], 'status': row['status']}
    if row.get('folder_metadata'):
        result['folder'] = row['folder_metadata']
        result['suggestedName'] = row['folder_metadata']['name']
    linked = product(c, user, row)
    if linked:
        result['product'] = {'sku': linked['sku'], 'revision': linked['revision']}
        if changes:
            result['productChanges'] = [{'product': linked, 'previousSku': None if row['created_product'] else linked['sku']}]
    elif row['status'] == 'identified':
        result['confirmationForm'] = {'title': '¿Cómo llamamos a este producto?', 'fields': [
            {'id': 'name', 'label': 'Nombre del producto', 'type': 'text', 'required': True,
             'value': result['suggestedName']}]}
    return result


class IntakeTools:
    """Prepared in the model loop; committed atomically with the chat response."""
    def __init__(self, database, user, thread_id, request_id):
        self.database, self.user = database, user
        self.thread_id, self.request_id = thread_id, request_id
        self.prepared = False
        self.reference = None

    def prepare(self, args):
        if args != {} or not isinstance(args, dict):
            return {'error': 'invalid_tool', 'message': 'La selección de materiales no admite datos adicionales.'}
        if not self.thread_id or not self.request_id:
            return {'error': 'thread_required', 'message': 'Abre una conversación para seleccionar los materiales.'}
        self.prepared = True
        return {'prepared': True, 'message': 'Se mostrará el selector de materiales sin exigir nombre ni SKU. '
                'El cliente elige la carpeta y confirma el nombre antes de crear el borrador. '
                'No se han leído ni analizado archivos.'}

    def present(self):
        return self.reference

    def commit(self, c, current):
        if not self.prepared:
            return None
        user = lock_owner(c, current)
        if user['id'] != self.user['id'] or user['google_subject'] != self.user['google_subject']:
            fail('account_changed', 'Tu cuenta ha cambiado. Vuelve a abrir la conversación.', 409)
        thread(c, user, self.thread_id)
        row = c.execute('''SELECT * FROM uony_product_intakes WHERE user_id=%s AND thread_id=%s
            AND (origin_request_id=%s OR status IN ('selecting','identified')) ORDER BY created_at DESC LIMIT 1''',
            (user['id'], self.thread_id, self.request_id)).fetchone()
        if row and row['google_subject'] != user['google_subject']:
            fail('account_changed', 'La identidad de esta selección ha cambiado. Abre una nueva conversación.', 409)
        if not row:
            row = c.execute('''INSERT INTO uony_product_intakes(user_id,id,thread_id,google_subject,origin_request_id)
                VALUES(%s,%s,%s,%s,%s) RETURNING *''',
                (user['id'], uuid4(), self.thread_id, user['google_subject'], self.request_id)).fetchone()
        self.reference = {'id': str(row['id']), 'revision': row['revision']}
        return self.reference


class ProductIntake:
    def __init__(self, settings, database, drive):
        self.settings, self.database, self.drive = settings, database, drive
        self.cipher = Fernet(settings.encryption_key)

    def credentials(self, c, user, refresh=False):
        row = c.execute('SELECT * FROM google_drive_connections WHERE user_id=%s', (user['id'],)).fetchone()
        if not row:
            raise HTTPException(409, detail={'error': 'not_connected', 'message': 'Conecta Google Drive para elegir tus materiales.',
                                            'connectionActions': [{'provider': 'drive', 'action': 'manage'}]})
        require_same_connection(user, row)
        if row['status'] != 'connected':
            raise HTTPException(409, detail={'error': 'reauthorize', 'message': 'Renueva la conexión con Drive para continuar.',
                                            'connectionActions': [{'provider': 'drive', 'action': 'manage'}]})
        return self.drive.refresh(self.cipher.decrypt(row['refresh_encrypted'].encode()).decode()) if refresh else None

    def get(self, c, user, identifier, thread_id):
        require_access(c, user)
        row = find(c, user, identifier, thread_id)
        # Recover the owner's saved state even after Drive is disconnected, so
        # the existing connection controls can explain and restore permission.
        # Reading or changing that selection still checks current credentials.
        return dto(c, user, row)

    def replay(self, c, user, row, body, operation, data):
        fingerprint = sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        previous = c.execute('SELECT * FROM uony_product_intake_requests WHERE user_id=%s AND request_id=%s',
                             (user['id'], body.requestId)).fetchone()
        if previous:
            if previous['intake_id'] != row['id'] or previous['operation'] != operation or previous['fingerprint'] != fingerprint:
                fail('intake_request_conflict', 'Esta solicitud corresponde a otra selección o respuesta.', 409)
            return fingerprint, dto(c, user, row, changes=operation == 'product')
        if row['revision'] != body.revision:
            fail('intake_conflict', 'La selección ha cambiado. Actualiza su estado antes de continuar; tus datos se conservan.', 409)
        return fingerprint, None

    def record(self, c, user, row, body, operation, fingerprint):
        c.execute('''INSERT INTO uony_product_intake_requests(user_id,request_id,intake_id,operation,fingerprint)
            VALUES(%s,%s,%s,%s,%s)''', (user['id'], body.requestId, row['id'], operation, fingerprint))

    def existing(self, c, user, folder_id):
        rows = c.execute('''SELECT DISTINCT p.id,p.sku,p.data FROM products p WHERE p.user_id=%s
            AND p.deleted_at IS NULL AND (EXISTS(SELECT 1 FROM uony_product_intakes i WHERE i.user_id=p.user_id
                AND i.product_id=p.id AND i.google_subject=%s AND i.folder_id=%s)
            OR EXISTS(SELECT 1 FROM product_material_jobs j WHERE j.user_id=p.user_id AND j.product_id=p.id
                AND j.google_subject=%s AND j.folder_id=%s)) LIMIT 2''',
            (user['id'], user['google_subject'], folder_id, user['google_subject'], folder_id)).fetchall()
        if len(rows) > 1:
            raise HTTPException(409, detail={'error': 'intake_product_ambiguous',
                'message': 'Esta carpeta está vinculada a varios productos. Indica a Uony cuál quieres continuar antes de crear otro.',
                'productChoices': [{'sku': row['sku'], 'name': row['data']['name']} for row in rows]})
        return rows[0] if rows else None

    def select_folder(self, c, user, identifier, body):
        user = lock_owner(c, user)
        row = find(c, user, identifier, body.threadId, lock=True)
        self.credentials(c, user)
        fingerprint, repeated = self.replay(c, user, row, body, 'folder', body.model_dump(mode='json'))
        if repeated:
            return repeated
        if row['status'] == 'linked':
            fail('intake_linked', 'Esta selección ya tiene un producto. Pide a Uony una nueva selección para otro producto.', 409)
        token = self.credentials(c, user, refresh=True)
        item = self.drive.metadata(token, file_id(body.folderId))
        name = item.get('name')
        if item.get('id') != body.folderId or item.get('mimeType') != FOLDER or item.get('trashed'):
            fail('invalid_folder', 'Elige una carpeta disponible de Google Drive.', 409)
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 500 or any(ord(char) < 32 for char in name):
            fail('invalid_folder', 'El nombre de esa carpeta no se puede utilizar aquí. Selecciona otra carpeta.', 409)
        associated = self.existing(c, user, body.folderId)
        row = c.execute('''UPDATE uony_product_intakes SET folder_id=%s,folder_metadata=%s,product_id=%s,
            status=%s,revision=revision+1,updated_at=now() WHERE user_id=%s AND id=%s RETURNING *''',
            (body.folderId, Jsonb({'id': body.folderId, 'name': name.strip()}), associated['id'] if associated else None,
             'linked' if associated else 'identified', user['id'], row['id'])).fetchone()
        self.record(c, user, row, body, 'folder', fingerprint)
        if associated:
            linked = c.execute('SELECT * FROM products WHERE user_id=%s AND id=%s AND deleted_at IS NULL',
                               (user['id'], associated['id'])).fetchone()
            bind_product(c, user, body.threadId, linked, 'intake')
        return dto(c, user, row, changes=bool(associated))

    def create_product(self, c, user, identifier, body):
        user = lock_owner(c, user)
        row = find(c, user, identifier, body.threadId, lock=True)
        self.credentials(c, user)
        fingerprint, repeated = self.replay(c, user, row, body, 'product', body.model_dump(mode='json'))
        if repeated:
            return repeated
        name = body.name.strip()
        if not name or any(ord(char) < 32 for char in name):
            fail('invalid_product', 'Escribe un nombre para reconocer este producto.')
        if row['status'] == 'linked':
            fail('intake_linked', 'El producto ya está guardado. Continúa con su ficha sin crear otra.', 409)
        if row['status'] != 'identified':
            fail('intake_folder_required', 'Selecciona primero la carpeta de este producto.', 409)
        # A second thread may have linked this folder since identification.
        associated = self.existing(c, user, row['folder_id'])
        previous_sku = associated['sku'] if associated else None
        if associated:
            saved = present(c.execute('SELECT * FROM products WHERE user_id=%s AND id=%s',
                                     (user['id'], associated['id'])).fetchone())
        else:
            sku = 'UON-' + uuid4().hex[:16].upper()
            while c.execute('SELECT 1 FROM products WHERE user_id=%s AND lower(sku)=lower(%s) AND deleted_at IS NULL',
                            (user['id'], sku)).fetchone():
                sku = 'UON-' + uuid4().hex[:16].upper()
            saved = save(c, user, {'name': name, 'sku': sku}, source='uony-intake')
        row = c.execute('''UPDATE uony_product_intakes SET product_id=%s,confirmed_name=%s,created_product=%s,status='linked',
            revision=revision+1,updated_at=now() WHERE user_id=%s AND id=%s RETURNING *''',
            (saved['id'], name, not bool(associated), user['id'], row['id'])).fetchone()
        self.record(c, user, row, body, 'product', fingerprint)
        linked = c.execute('SELECT * FROM products WHERE user_id=%s AND id=%s AND deleted_at IS NULL',
                           (user['id'], UUID(saved['id']))).fetchone()
        bind_product(c, user, body.threadId, linked, 'intake')
        result = dto(c, user, row)
        result['productChanges'] = [{'product': saved, 'previousSku': previous_sku}]
        return result
