"""Materiales Drive del usuario: selección persistente, lectura y subida acotada."""
import hashlib
from urllib.parse import quote
from uuid import UUID
from cryptography.fernet import Fernet
from fastapi import APIRouter, Request, HTTPException, Query
from fastapi.responses import JSONResponse, Response
from pydantic import Field
from psycopg.types.json import Jsonb
from .onboarding import require_user, StrictBody
from .google_cloud_routes import entitled
from .google_account import require_same_connection
from .security import require_origin
from .google_cloud_provider import CloudError
from .google_drive_provider import public_file, file_id, FOLDER, MAX_BYTES

MESSAGES = {
    'google_unavailable': 'No podemos consultar Drive ahora. Puedes volver a intentarlo.',
    'permission_denied': 'Google no permite acceder a ese archivo. Revisa la cuenta y los permisos de Drive.',
    'reauthorize': 'Vuelve a conectar Google Drive para renovar el permiso.',
    'invalid_file': 'Ese archivo ya no está disponible o no es válido.',
    'file_too_large': 'El archivo supera el límite de 20 MB de esta carga.',
    'unsupported_file': 'Este tipo de archivo todavía no se puede utilizar aquí.',
    'rate_limited': 'Google Drive está limitando las consultas. Vuelve a intentarlo en unos segundos.',
    'file_forbidden': 'El propietario o tu organización no permiten descargar ese archivo.',
    'quota_exceeded': 'Google Drive ha alcanzado un límite de uso temporal. Inténtalo más tarde.',
}


class Selection(StrictBody):
    fileId: str = Field(pattern=r'^[A-Za-z0-9_-]{1,200}$')


def routes(settings, database, provider):
    router = APIRouter(prefix='/api/connections/google-drive')
    cipher = Fernet(settings.encryption_key)

    def credentials(connection, user):
        row = connection.execute('SELECT * FROM google_drive_connections WHERE user_id=%s FOR UPDATE', (user['id'],)).fetchone()
        if not row:
            raise HTTPException(409, detail={'error':'not_connected','message':'Conecta Google Drive para utilizar tus archivos.'})
        require_same_connection(user, row)
        return row, provider.refresh(cipher.decrypt(row['refresh_encrypted'].encode()).decode())

    def failed(error, connection, user):
        if error.code == 'reauthorize':
            connection.execute("UPDATE google_drive_connections SET status='reauthorize' WHERE user_id=%s", (user['id'],))
        return JSONResponse({'error':error.code,'message':MESSAGES.get(error.code,MESSAGES['google_unavailable'])},
                            status_code=413 if error.code=='file_too_large' else 409 if error.code in ('reauthorize','invalid_file','unsupported_file') else 503)

    def save(connection, user, row, item):
        if item['mimeType'] == FOLDER:
            raise CloudError('unsupported_file')
        data = public_file(item)
        connection.execute('''INSERT INTO drive_materials(user_id,google_subject,file_id,metadata) VALUES(%s,%s,%s,%s)
            ON CONFLICT(user_id,google_subject,file_id) DO UPDATE SET metadata=EXCLUDED.metadata,selected_at=now()''',
            (user['id'],row['google_subject'],item['id'],Jsonb(data)))
        return data

    @router.get('/files')
    def files(request: Request, parent: str = Query('root', pattern=r'^[A-Za-z0-9_-]{1,200}$'),
              page: str | None = Query(None,max_length=2048), search: str = Query('',max_length=200)):
        with database.connect() as connection:
            user = entitled(connection, request)
            try:
                _, token = credentials(connection, user)
                return provider.files(token,parent,page,search)
            except CloudError as error:
                return failed(error,connection,user)

    @router.get('/materials')
    def materials(request: Request):
        with database.connect() as connection:
            user = require_user(connection, request)
            rows = connection.execute('''SELECT m.metadata FROM drive_materials m JOIN google_drive_connections c
                ON c.user_id=m.user_id AND c.google_subject=m.google_subject
                WHERE m.user_id=%s AND c.google_subject=%s AND c.status<>'account_mismatch' ORDER BY m.selected_at DESC LIMIT 100''', (user['id'],user['google_subject'])).fetchall()
            return {'files':[r['metadata'] for r in rows]}

    @router.post('/materials')
    def select(body: Selection, request: Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user = entitled(connection,request)
            try:
                row,token = credentials(connection,user)
                return {'file':save(connection,user,row,provider.metadata(token,body.fileId))}
            except CloudError as error:
                return failed(error,connection,user)

    @router.delete('/materials/{identifier}')
    def remove(identifier: str, request: Request):
        require_origin(request,settings.origin)
        with database.connect() as connection:
            user = require_user(connection,request)
            connection.execute('DELETE FROM drive_materials WHERE user_id=%s AND file_id=%s', (user['id'],identifier))
        return {'removed':True}  # Retirar la referencia no borra el original de Drive.

    @router.get('/materials/{identifier}/content')
    def download(identifier: str, request: Request):
        with database.connect() as connection:
            user = entitled(connection,request)
            try:
                row,token = credentials(connection,user)
                selected = connection.execute('SELECT 1 FROM drive_materials WHERE user_id=%s AND google_subject=%s AND file_id=%s',
                    (user['id'],row['google_subject'],file_id(identifier))).fetchone()
                if not selected:
                    raise CloudError('invalid_file')
                data,mime,name = provider.content(token,identifier)
                return Response(data, media_type=mime,headers={'Content-Disposition':"attachment; filename*=UTF-8''"+quote(name,safe='')})
            except CloudError as error:
                return failed(error,connection,user)

    @router.post('/upload')
    async def upload(request: Request, name: str = Query(min_length=1,max_length=180), requestId: UUID = Query()):
        require_origin(request,settings.origin)
        mime = request.headers.get('content-type','application/octet-stream')
        allowed = ('image/jpeg','image/png','image/webp','application/pdf','text/plain','text/csv','video/mp4',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        if mime not in allowed or any(ord(c)<32 for c in name) or '/' in name or '\\' in name:
            raise HTTPException(400,detail={'error':'unsupported_file','message':'Usa imágenes, PDF, texto, Word, Excel o vídeo MP4.'})
        with database.connect() as connection:
            user = entitled(connection,request)
            chunks,size=[],0
            async for chunk in request.stream():
                size+=len(chunk)
                if size>MAX_BYTES:
                    return failed(CloudError('file_too_large'),connection,user)
                chunks.append(chunk)
            content=b''.join(chunks)
            if not content:
                raise HTTPException(400,detail={'error':'empty_file','message':'El archivo está vacío.'})
            try:
                row,token=credentials(connection,user)
                fingerprint=hashlib.sha256(name.encode()+b'\0'+mime.encode()+b'\0'+content).hexdigest()
                previous=connection.execute('SELECT * FROM drive_uploads WHERE user_id=%s AND google_subject=%s AND request_id=%s',
                    (user['id'],row['google_subject'],requestId)).fetchone()
                if previous and previous['fingerprint']!=fingerprint:
                    raise HTTPException(409,detail={'error':'upload_conflict','message':'Esta carga corresponde a otro archivo.'})
                identifier=previous['file_id'] if previous else provider.reserve_id(token)
                if not previous:
                    connection.execute('INSERT INTO drive_uploads VALUES(%s,%s,%s,%s,%s)',
                        (user['id'],row['google_subject'],requestId,identifier,fingerprint))
                folder=row['folder_id'] or provider.folder(token)
                connection.execute('UPDATE google_drive_connections SET folder_id=%s WHERE user_id=%s',(folder,user['id']))
                # Reservar ID antes del envío permite recuperar un resultado de red desconocido sin duplicar.
                connection.commit()
                item=provider.upload(token,folder,identifier,name,mime,content)
                current=connection.execute('SELECT google_subject FROM google_drive_connections WHERE user_id=%s FOR UPDATE',(user['id'],)).fetchone()
                if not current or current['google_subject']!=row['google_subject']:
                    raise CloudError('reauthorize')
                return {'file':save(connection,user,row,item)}
            except CloudError as error:
                return failed(error,connection,user)

    return router
