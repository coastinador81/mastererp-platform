"""Conexión en Nexus y trabajos locales asociados a la ficha de Producto."""
from uuid import UUID
from fastapi import APIRouter, Request
from fastapi.responses import Response
from pydantic import Field
from .onboarding import StrictBody, require_user
from .security import require_origin
from .products import fail
from . import blender_store as store


class Pair(StrictBody):
    pairId: UUID = Field(strict=False)


class Job(StrictBody):
    requestId: UUID = Field(strict=False)
    productId: UUID|None = Field(default=None,strict=False)


def user_for(connection,request):
    user=require_user(connection,request)
    request.state.blender_user_id=user['id']
    return user


def routes(settings,database):
    router=APIRouter(prefix='/api/connections/blender-local')

    @router.get('')
    def status(request:Request,productId:UUID|None=None):
        with database.connect() as c:return store.status(c,user_for(c,request),product_id=productId)

    @router.get('/pair/{pair_id}')
    def pair(pair_id:UUID,request:Request):
        with database.connect() as c:
            user=user_for(c,request)
            row=c.execute('''SELECT * FROM blender_agents WHERE id=%s AND revoked_at IS NULL
                AND (user_id=%s OR (user_id IS NULL AND pair_expires_at>now()))''',(pair_id,user['id'])).fetchone()
            if not row:fail('blender_pair_not_found','La vinculación ha caducado o no está disponible. Abre de nuevo el conector local.',404)
            return {'deviceName':row['device_name'],'expiresAt':store.iso(row['pair_expires_at'])}

    @router.post('/connect')
    def connect(body:Pair,request:Request):
        require_origin(request,settings.origin)
        with database.connect() as c:
            user=user_for(c,request);store.require_access(c,user)
            row=c.execute('SELECT * FROM blender_agents WHERE id=%s FOR UPDATE',(body.pairId,)).fetchone()
            if not row or row['revoked_at'] or (row['user_id'] and row['user_id']!=user['id']):
                fail('blender_pair_not_found','Esta vinculación no está disponible.',404)
            if not row['user_id']:
                valid=c.execute('SELECT 1 FROM blender_agents WHERE id=%s AND pair_expires_at>now()',(body.pairId,)).fetchone()
                if not valid:fail('blender_pair_expired','La vinculación ha caducado. Abre de nuevo el conector local.',409)
                store.disconnect(c,user['id'])
                c.execute('UPDATE blender_agents SET user_id=%s,paired_at=now() WHERE id=%s',(user['id'],body.pairId))
            return store.status(c,user)

    @router.post('/disconnect')
    def disconnect(request:Request):
        require_origin(request,settings.origin)
        with database.connect() as c:
            user=user_for(c,request);store.disconnect(c,user['id'])
            return store.status(c,user)

    def enqueue(body,request,operation):
        require_origin(request,settings.origin)
        with database.connect() as c:
            return {'job':store.enqueue(c,user_for(c,request),body.requestId,operation,
                                       source='product' if body.productId else 'nexus',product_id=body.productId)}

    @router.post('/inspect')
    def inspect(body:Job,request:Request):return enqueue(body,request,'inspect_scene')

    @router.post('/preview')
    def preview(body:Job,request:Request):return enqueue(body,request,'render_preview')

    @router.get('/jobs')
    def product_jobs(productId:UUID,request:Request):
        with database.connect() as c:
            user=user_for(c,request);store.expire_jobs(c,user['id'])
            return {'lastJob':store.latest_job(c,user['id'],productId),
                    'lastPreview':store.latest_job(c,user['id'],productId,preview_only=True)}

    @router.get('/jobs/{job_id}')
    def job(job_id:UUID,request:Request):
        with database.connect() as c:
            user=user_for(c,request);store.expire_jobs(c,user['id'])
            return {'job':store.present_job(store.find_job(c,user['id'],job_id))}

    @router.get('/previews/{job_id}')
    def image(job_id:UUID,request:Request):
        with database.connect() as c:
            row=store.find_job(c,user_for(c,request)['id'],job_id)
            if row['status']!='completed' or not row['preview']:fail('blender_preview_not_found','La vista previa no está disponible.',404)
            return Response(bytes(row['preview']),media_type='image/png',headers={'Content-Disposition':'inline; filename="blender-preview.png"'})
    return router
