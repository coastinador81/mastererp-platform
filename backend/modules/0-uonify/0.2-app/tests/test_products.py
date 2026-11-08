from uuid import uuid4
from unittest.mock import patch
from cryptography.fernet import Fernet
from psycopg.types.json import Jsonb
from conftest import client_for,login
from test_uony import ready
from test_google_cloud import Cloud
from test_uony_provider import response


def connect(db,config):
    with db.connect() as c:
        user=c.execute('SELECT id FROM users').fetchone()['id']
        c.execute("INSERT INTO google_cloud_connections(user_id,google_subject,email,refresh_encrypted,scope,project_id,project_check) VALUES(%s,'google-test-one','one@example.test',%s,'cloud-platform','project-fixture',%s)",(user,Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode(),Jsonb({'ready':True})))
        c.execute("INSERT INTO uony_model_checks(user_id,project_id,google_subject,model,effort) VALUES(%s,'project-fixture','google-test-one','gemini-3.5-flash','medium')",(user,))


def test_catalog_persistence_revisions_validation_and_isolation(environment):
    config,google,db=environment
    data={'name':'Juego de madera','sku':'TEST-01','brand':'Prueba','bullets':['25 piezas'],'customFields':[{'id':'pieces','name':'Piezas','value':'25','type':'number','options':[],'isConfirmed':True}]}
    with client_for(config,google) as client:
        assert client.get('/api/products').status_code==401
        ready(client,google,db)
        assert client.get('/api/products').json()=={'products':[]}
        assert client.post('/api/products',json=data,headers={'Origin':'null'}).status_code==403
        first=client.post('/api/products',json=data).json()['product']
        assert first['revision']==1 and first['customFields']==data['customFields']
        assert client.post('/api/products',json={**data,'sku':'test-01'}).status_code==409
        for invalid in [{'sku':'nuevo'},{'stock':-1},{'price':'NaN'},{'bullets':['x']*7},{'user_id':'other'}]:
            assert client.post('/api/products',json={**data,**invalid}).status_code==400
        newer=client.patch('/api/products/TEST-01',json={'revision':1,'description':'Descripción guardada'}).json()['product']
        assert newer['revision']==2 and newer['bullets']==data['bullets']
        assert client.patch('/api/products/TEST-01',json={'revision':1,'name':'Edición antigua'}).status_code==409
        assert client.patch('/api/products/TEST-01',json={'name':'Sin revisión'}).status_code==409
    with client_for(config,google) as client:
        login(client,google)
        assert client.get('/api/products').json()['products']==[newer]
        google.subject='other';google.email='other@example.test';login(client,google)
        assert client.get('/api/products').json()=={'products':[]}
        assert client.delete('/api/products/TEST-01').status_code==404
        google.subject='google-test-one';google.email='one@example.test';login(client,google)
        with db.connect() as c:c.execute('UPDATE access_periods SET ends_at=now()')
        assert client.patch('/api/products/TEST-01',json={'revision':2,'name':'Caducado'}).status_code==403
        assert client.get('/api/products').json()['products']==[newer]
        assert client.delete('/api/products/TEST-01').status_code==200
        assert client.get('/api/products').json()=={'products':[]}


def test_real_tool_loop_creates_updates_and_replays_without_duplication(environment):
    config,google,db=environment
    def tool(name,args):return response([{'functionCall':{'name':name,'args':args}}])
    with client_for(config,google,cloud=Cloud()) as client:
        ready(client,google,db);connect(db,config)
        body={'requestId':str(uuid4()),'threadId':'product-test','text':'Crea TEST-02, juego de madera'}
        with patch('app.uony_provider.requests.post',side_effect=[tool('create_product',{'sku':'TEST-02','name':'Juego de madera'}),response([{'text':'He creado el borrador.'}])]) as post:
            result=client.post('/api/uony/messages',json=body)
            assert result.status_code==200,result.text
            proposal=result.json()['productProposal']
            assert result.json()['productChanges']==[] and proposal['targetSku']=='TEST-02'
            assert client.get('/api/products').json()['products']==[]
            assert client.post('/api/uony/messages',json=body).json()==result.json()
            assert post.call_count==2
        confirmed=client.post('/api/uony/product-proposals/'+proposal['proposalId']+'/decision',json={
            'threadId':body['threadId'],'requestId':str(uuid4()),'proposalHash':proposal['proposalHash'],
            'baseRevision':None,'action':'approve'})
        assert confirmed.status_code==200,confirmed.text
        product=client.get('/api/products').json()['products'][0]
        body={**body,'requestId':str(uuid4()),'text':'Añade la marca Prueba','productContext':{'sku':'TEST-02','revision':1}}
        with patch('app.uony_provider.requests.post',side_effect=[tool('get_product',{'sku':'TEST-02'}),tool('update_product',{'sku':'TEST-02','revision':1,'changes':{'brand':'Prueba'}}),response([{'text':'Marca guardada.'}])]):
            result=client.post('/api/uony/messages',json=body)
            assert result.status_code==200,result.text
        assert client.get('/api/products').json()['products'][0]==product
        proposal=result.json()['productProposal']
        approved=client.post('/api/uony/product-proposals/'+proposal['proposalId']+'/decision',json={
            'threadId':body['threadId'],'requestId':str(uuid4()),'proposalHash':proposal['proposalHash'],
            'baseRevision':1,'action':'approve'})
        assert approved.status_code==200,approved.text
        saved=client.get('/api/products').json()['products'][0]
        assert saved['id']==product['id'] and saved['revision']==2 and saved['brand']=='Prueba'
        assert approved.json()['productChanges'][0]['product']==saved
        assert client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]['productProposal']['status']=='approved'


def test_no_mutation_on_model_failure_or_concurrent_editor_save(environment):
    config,google,db=environment
    class Agent:
        fail=False
        def generate(self,token,project,history,status,**kwargs):
            assert status.call('get_product',{'sku':'CONCURRENT'})['product']['revision']==1
            assert status.call('update_product',{'sku':'CONCURRENT','revision':1,'changes':{'name':'Modelo'}})['prepared']
            if self.fail:
                from app.google_cloud_provider import CloudError
                raise CloudError('quota_exceeded')
            with db.connect() as c:c.execute("UPDATE products SET revision=2,data=data || '{\"name\":\"Edición manual\"}'")
            return 'Guardado',{}
    agent=Agent()
    with client_for(config,google,cloud=Cloud(),uony=agent) as client:
        ready(client,google,db);connect(db,config)
        client.post('/api/products',json={'sku':'CONCURRENT','name':'Original'})
        body={'requestId':str(uuid4()),'threadId':'race','text':'Cambia el nombre'}
        agent.fail=True
        assert client.post('/api/uony/messages',json=body).status_code==503
        assert client.get('/api/products').json()['products'][0]['name']=='Original'
        agent.fail=False
        # An uncertain attempt cannot be repeated implicitly. The isolated
        # fixture explicitly acknowledges it before testing an editor race.
        retried=client.post('/api/uony/messages',json={**body,'requestId':str(uuid4()),
            'retryOf':body['requestId']})
        assert retried.status_code==409,retried.text
        assert client.get('/api/products').json()['products'][0]['name']=='Edición manual'
        messages=client.get('/api/uony/threads').json()['threads'][0]['messages']
        assert len(messages)==4 and messages[1]['requestStatus']=='unknown'
        assert messages[-1]['requestStatus']=='error'
        assert messages[-1].get('productProposal') is None
        assert messages[-1].get('productChanges') is None


def test_tools_reject_foreign_ids_unread_updates_and_unknown_fields(environment):
    config,google,db=environment
    from app.product_tools import ProductTools
    with client_for(config,google) as client:
        ready(client,google,db)
        client.post('/api/products',json={'sku':'OWN','name':'Propio'})
        with db.connect() as c:user=c.execute('SELECT * FROM users').fetchone()
        tools=ProductTools({},db,user,None)
        assert tools.call('get_product',{'sku':'FOREIGN'})['error']=='product_not_found'
        assert tools.call('update_product',{'sku':'OWN','revision':1,'changes':{'name':'Cambiado'}})['error']=='read_required'
        assert tools.call('create_product',{'sku':'X','name':'X','user_id':'other'})['error']=='invalid_tool'
        assert tools.call('update_product',{'sku':'OWN','revision':1,'changes':{'status':'published'}})['error']=='invalid_tool'
        assert tools.pending is None
