from uuid import UUID,uuid4
from conftest import client_for
from test_uony import ready
from test_blender_local import BASE,POLL,SCENE,pair,native,png
from app.blender_tools import BusinessTools


def product(client,sku):
    response=client.post('/api/products',json={'sku':sku,'name':'Producto '+sku})
    assert response.status_code==200
    return response.json()['product']


def finish(client,token,job):
    assert native(client,'poll',POLL,token).json()['job']['id']==job['id']
    report={'jobId':job['id'],'status':'completed','result':{'scene':SCENE},'durationMs':15}
    if job['operation']=='render_preview':
        import base64
        report['previewBase64']=base64.b64encode(png()).decode()
    assert native(client,'report',report,token).status_code==200


def test_product_jobs_never_fall_back_to_other_product(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        ready(client,google,db);token=pair(client)
        one=product(client,'ONE');two=product(client,'TWO')
        request_id=str(uuid4())
        body={'requestId':request_id,'productId':one['id']}
        job=client.post(BASE+'/inspect',json=body).json()['job']
        assert job['productId']==one['id']
        assert client.post(BASE+'/inspect',json=body).json()['job']['id']==job['id']
        assert client.post(BASE+'/inspect',json={**body,'productId':two['id']}).status_code==409
        assert client.post(BASE+'/inspect',json={'requestId':request_id}).status_code==409
        finish(client,token,job)
        assert client.get(BASE,params={'productId':one['id']}).json()['lastJob']['id']==job['id']
        status=client.get(BASE,params={'productId':two['id']}).json()
        assert status['productId']==two['id'] and status['lastJob'] is None
        assert client.get(BASE+'/jobs',params={'productId':two['id']}).json()=={'lastJob':None,'lastPreview':None}
        other=client.post(BASE+'/inspect',json={'requestId':str(uuid4()),'productId':two['id']}).json()['job']
        assert client.get(BASE+'/jobs',params={'productId':one['id']}).json()['lastJob']['id']==job['id']
        assert client.get(BASE+'/jobs',params={'productId':two['id']}).json()['lastJob']['id']==other['id']
        with db.connect() as c:
            saved=c.execute('SELECT source,product_id FROM blender_jobs WHERE id=%s',(job['id'],)).fetchone()
            assert saved=={'source':'product','product_id':UUID(one['id'])}


def test_product_scope_requires_owner_and_live_product(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        ready(client,google,db);pair(client);owned=product(client,'OWNED')
        assert client.delete('/api/products/OWNED').status_code==200
        body={'requestId':str(uuid4()),'productId':owned['id']}
        assert client.post(BASE+'/inspect',json=body).status_code==404
        assert client.get(BASE,params={'productId':owned['id']}).status_code==404
        alive=product(client,'ALIVE')
        google.subject='second-blender-owner';google.email='second@example.test'
        ready(client,google,db)
        assert client.get(BASE+'/jobs',params={'productId':alive['id']}).status_code==404
        assert client.get(BASE,params={'productId':alive['id']}).status_code==404
        assert client.post(BASE+'/inspect',json={**body,'productId':alive['id']}).status_code==404
        assert client.post(BASE+'/inspect',json={**body,'productId':str(uuid4())}).status_code==404


def test_uony_uses_verified_active_product_and_scoped_history(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        ready(client,google,db);token=pair(client)
        one=product(client,'UONY-ONE');two=product(client,'UONY-TWO')
        with db.connect() as c:user=c.execute('SELECT * FROM users').fetchone()
        tools=BusinessTools({},db,user,{'sku':one['sku'],'revision':one['revision']},uuid4())
        job=tools.call('inspect_blender_scene',{})['job']
        assert job['productId']==one['id']
        finish(client,token,job)
        assert tools.call('get_blender_status',{})['lastJob']['id']==job['id']
        other=BusinessTools({},db,user,{'sku':two['sku'],'revision':two['revision']},uuid4())
        result=other.call('get_blender_status',{})
        assert result['productId']==two['id'] and result['lastJob'] is None
        assert client.delete('/api/products/'+two['sku']).status_code==200
        assert other.call('inspect_blender_scene',{})['error']=='product_not_found'


def test_existing_unscoped_jobs_remain_unassociated(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        ready(client,google,db);token=pair(client)
        original=client.post(BASE+'/inspect',json={'requestId':str(uuid4())}).json()['job']
        assert original['productId'] is None
        finish(client,token,original)
        current=product(client,'NEW')
        assert client.get(BASE,params={'productId':current['id']}).json()['lastJob'] is None
        assert client.get(BASE+'/jobs/'+original['id']).json()['job']['productId'] is None


def test_inspection_preserves_only_current_product_preview(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        ready(client,google,db);token=pair(client)
        one=product(client,'PREVIEW-ONE');two=product(client,'PREVIEW-TWO')
        image=client.post(BASE+'/preview',json={'requestId':str(uuid4()),'productId':one['id']}).json()['job']
        finish(client,token,image)
        inspection=client.post(BASE+'/inspect',json={'requestId':str(uuid4()),'productId':one['id']}).json()['job']
        finish(client,token,inspection)
        current=client.get(BASE,params={'productId':one['id']}).json()
        assert current['lastJob']['id']==inspection['id']
        assert current['lastPreview']['id']==image['id']
        assert client.get(current['lastPreview']['previewUrl']).status_code==200
        other=client.get(BASE,params={'productId':two['id']}).json()
        assert other['lastJob'] is None and other['lastPreview'] is None


def test_deleted_product_is_not_dispatched_after_queueing(environment):
    config,google,db=environment
    with client_for(config,google) as client:
        ready(client,google,db);token=pair(client);one=product(client,'DELETE-QUEUED')
        job=client.post(BASE+'/inspect',json={'requestId':str(uuid4()),'productId':one['id']}).json()['job']
        assert client.delete('/api/products/'+one['sku']).status_code==200
        assert native(client,'poll',POLL,token).json()['job'] is None
        assert client.get(BASE+'/jobs/'+job['id']).json()['job']['status']=='failed'
