"""Puente saliente de la Mac: token privado, permisos estrechos y ninguna ejecución libre."""
import base64
import hashlib
import json
import struct
import zlib
from typing import Literal
from uuid import UUID,uuid4
from fastapi import APIRouter,Request
from pydantic import Field
from psycopg.types.json import Jsonb
from .onboarding import StrictBody
from .security import digest,random_token,limit_start
from .products import fail
from .access import workspace_access
from . import blender_store as store


class Register(StrictBody):
    deviceName:str=Field(min_length=1,max_length=80)


class Scene(StrictBody):
    name:str=Field(min_length=1,max_length=160)
    fileName:str=Field(max_length=255,pattern=r'^[^/\\]*$')
    objectCount:int=Field(ge=0,le=1000000)


class Poll(StrictBody):
    blenderVersion:str=Field(max_length=60)
    capabilities:list[Literal['inspect_scene','render_preview']]=Field(max_length=2)
    scene:Scene|None=None
    available:bool


class Object(StrictBody):
    name:str=Field(max_length=160)
    type:str=Field(max_length=40)


class SceneCount(StrictBody):
    name:str=Field(max_length=160)
    objectCount:int=Field(ge=0,le=1000000)


class Render(StrictBody):
    width:int=Field(ge=1,le=32768)
    height:int=Field(ge=1,le=32768)
    engine:str=Field(max_length=60)


class Result(StrictBody):
    scene:Scene
    objects:list[Object]=Field(default_factory=list,max_length=100)
    scenes:list[SceneCount]=Field(default_factory=list,max_length=30)
    render:Render|None=None


class Report(StrictBody):
    jobId:UUID=Field(strict=False)
    status:Literal['completed','failed']
    result:Result|None=None
    error:str|None=Field(default=None,max_length=500)
    durationMs:int=Field(ge=0,le=180000)
    previewBase64:str|None=Field(default=None,max_length=1398104)


def native_request(request):
    if request.headers.get('origin') is not None:
        fail('invalid_origin','Esta operación corresponde al conector local.',403)


def authenticated(connection,request):
    native_request(request)
    token=request.headers.get('authorization','')
    if not token.startswith('Bearer ') or len(token)>256:fail('blender_agent_required','Conector no autorizado.',401)
    row=connection.execute('SELECT * FROM blender_agents WHERE token_hash=%s',(digest(token[7:]),)).fetchone()
    if not row:fail('blender_agent_required','Conector no autorizado.',401)
    # El orden usuario → agente coincide con Nexus y evita carreras con desvinculación.
    user=None
    if row['user_id']:
        user=connection.execute('SELECT * FROM users WHERE id=%s FOR UPDATE',(row['user_id'],)).fetchone()
        if not user or user.get('deletion_requested_at'):
            fail('blender_agent_revoked','Esta cuenta ya no permite trabajar con el conector.',401)
        request.state.blender_user_id=user['id']
    row=connection.execute('SELECT * FROM blender_agents WHERE id=%s FOR UPDATE',(row['id'],)).fetchone()
    return row,user


def png_bytes(encoded):
    try:
        raw=base64.b64decode(encoded,validate=True)
        if len(raw)>1048576 or raw[:8]!=b'\x89PNG\r\n\x1a\n':raise ValueError()
        offset=8;output=bytearray(raw[:8]);seen=[]
        while offset<len(raw):
            size=struct.unpack('>I',raw[offset:offset+4])[0]
            kind=raw[offset+4:offset+8];data=raw[offset+8:offset+8+size]
            end=offset+12+size
            if end>len(raw) or zlib.crc32(kind+data)!=struct.unpack('>I',raw[offset+8+size:end])[0]:raise ValueError()
            if not seen:
                if kind!=b'IHDR' or size!=13:raise ValueError()
                width,height=struct.unpack('>II',data[:8])
                if not 1<=width<=1024 or not 1<=height<=1024:raise ValueError()
            if kind in (b'IHDR',b'PLTE',b'tRNS',b'IDAT',b'IEND'):output.extend(raw[offset:end])
            seen.append(kind);offset=end
            if kind==b'IEND':break
        if offset!=len(raw) or seen[-1]!=b'IEND' or b'IDAT' not in seen:raise ValueError()
        return bytes(output)
    except (ValueError,IndexError,struct.error):
        fail('invalid_preview','La vista previa debe ser un PNG válido de hasta 1 MiB y 1024 píxeles por lado.')


def routes(database):
    router=APIRouter(prefix='/api/blender-agent')

    @router.post('/register')
    def register(body:Register,request:Request):
        native_request(request);limit_start(database,request)
        pair_id=uuid4();token=random_token()
        with database.connect() as c:
            row=c.execute('''INSERT INTO blender_agents(id,token_hash,device_name,pair_expires_at)
                VALUES(%s,%s,%s,now()+interval '10 minutes') RETURNING pair_expires_at''',
                (pair_id,digest(token),body.deviceName)).fetchone()
        return {'pairId':str(pair_id),'agentToken':token,'approvalUrl':f'/espacio/nexus?blenderPair={pair_id}',
                'expiresAt':store.iso(row['pair_expires_at'])}

    @router.post('/poll')
    def poll(body:Poll,request:Request):
        with database.connect() as c:
            agent,user=authenticated(c,request)
            if agent['revoked_at']:return {'status':'disconnected','job':None}
            if not user:
                pending=c.execute('SELECT pair_expires_at>now() AS valid FROM blender_agents WHERE id=%s',(agent['id'],)).fetchone()['valid']
                return {'status':'pending' if pending else 'disconnected','job':None}
            store.expire_jobs(c,user['id'])
            c.execute('''UPDATE blender_agents SET last_seen_at=now(),available=%s,blender_version=%s,
                capabilities=%s,scene=coalesce(%s,scene) WHERE id=%s''',
                (body.available,body.blenderVersion,Jsonb(body.capabilities),Jsonb(body.scene.model_dump()) if body.scene else None,agent['id']))
            allowed=bool(user.get('onboarding_completed_at')) and workspace_access(c,user)['status']=='allowed'
            if not allowed:
                c.execute("""UPDATE blender_jobs SET status='failed',error='El acceso a Uonify ha caducado.',finished_at=now()
                    WHERE agent_id=%s AND status='queued'""",(agent['id'],))
            job=None
            running=c.execute("SELECT 1 FROM blender_jobs WHERE agent_id=%s AND status='running'",(agent['id'],)).fetchone()
            if body.available and allowed and not running:
                next_job=c.execute("SELECT id,operation,product_id FROM blender_jobs WHERE agent_id=%s AND status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE",(agent['id'],)).fetchone()
                if next_job and next_job['product_id'] and not c.execute('''SELECT 1 FROM products
                    WHERE user_id=%s AND id=%s AND deleted_at IS NULL''',(user['id'],next_job['product_id'])).fetchone():
                    c.execute("UPDATE blender_jobs SET status='failed',error='El producto asociado ya no está disponible.',finished_at=now() WHERE id=%s",(next_job['id'],))
                    next_job=None
                if next_job and next_job['operation'] in body.capabilities:
                    c.execute("UPDATE blender_jobs SET status='running',started_at=now(),lease_expires_at=now()+interval '180 seconds' WHERE id=%s",(next_job['id'],))
                    job={'id':str(next_job['id']),'operation':next_job['operation']}
            return {'status':'connected','job':job}

    @router.post('/report')
    def report(body:Report,request:Request):
        preview=png_bytes(body.previewBase64) if body.previewBase64 else None
        payload=body.model_dump(mode='json')
        report_hash=hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        with database.connect() as c:
            agent,user=authenticated(c,request)
            if agent['revoked_at'] or not user:fail('blender_agent_revoked','Este conector ya no está vinculado.',401)
            store.expire_jobs(c,user['id'])
            row=c.execute('SELECT * FROM blender_jobs WHERE id=%s AND user_id=%s AND agent_id=%s FOR UPDATE',(body.jobId,user['id'],agent['id'])).fetchone()
            if not row:fail('blender_job_not_found','No se encuentra este trabajo.',404)
            if row['report_hash']==report_hash:return {'ok':True}
            if row['status']!='running':fail('blender_report_conflict','El trabajo ya no admite este resultado.',409)
            if body.status=='completed' and not body.result:fail('invalid_report','Falta el resultado de Blender.')
            if row['operation']=='render_preview' and body.status=='completed' and not preview:fail('invalid_preview','Falta la vista previa PNG.')
            if preview and (row['operation']!='render_preview' or body.status!='completed'):fail('invalid_preview','Este trabajo no admite una imagen.')
            result=body.result.model_dump() if body.result else None
            error=(body.error or 'Blender no pudo completar el trabajo.') if body.status=='failed' else None
            c.execute('''UPDATE blender_jobs SET status=%s,result=%s,error=%s,preview=%s,report_hash=%s,
                local_duration_ms=%s,finished_at=now() WHERE id=%s''',
                (body.status,Jsonb(result),error,preview,report_hash,body.durationMs,body.jobId))
            if body.result:c.execute('UPDATE blender_agents SET scene=%s WHERE id=%s',(Jsonb(body.result.scene.model_dump()),agent['id']))
            return {'ok':True}
    return router
