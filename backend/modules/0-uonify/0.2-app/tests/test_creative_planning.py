"""Plan creativo desde la conversación real, sin llamada de generación multimedia."""
from uuid import uuid4

from cryptography.fernet import Fernet
from psycopg.types.json import Jsonb
from pydantic import ValidationError

from conftest import client_for, login
from test_uony import ready
from app.creative_planning import CreativeTools, PlanInput, RECIPES, response, route, AUDITED_PROJECT, model_choice_form
from app.conversation_forms import ConversationForms
from app.onboarding import DOCUMENTS


class Planner:
    def __init__(self):
        self.calls = 0

    def generate(self, token, project, history, status, model=None, effort=None):
        self.calls += 1
        assert project == 'project-fixture'
        result = status.call('prepare_creative_plan', {
            'recipe':'review_card', 'objective':'Preparar un anuncio de producto',
            'audience':'Personas que compran para su hogar',
            'offer':'Producto con características confirmadas',
            'assetNeeds':['foto real del producto']})
        assert result['prepared'] is True
        return 'Propuesta inicial.', {'calls':1,'attemptedCalls':1,'totalTokenCount':40}


class VideoPlanner:
    def __init__(self):
        self.calls=0

    def generate(self, token, project, history, status, model=None, effort=None):
        self.calls+=1
        assert project == AUDITED_PROJECT
        result=status.call('prepare_creative_plan', {
            'recipe':'cinematic_video','objective':'Una ciudad bajo la lluvia nocturna',
            'sourceMode':'uony_concept'})
        assert result['prepared'] is True
        return 'Borrador preparado.', {'calls':1,'attemptedCalls':1,'totalTokenCount':40}


def connect(client, google, db, config):
    ready(client, google, db)
    with db.connect() as connection:
        user = connection.execute('SELECT id FROM users WHERE google_subject=%s',
                                  (google.subject,)).fetchone()['id']
        connection.execute('''INSERT INTO google_cloud_connections
            (user_id,google_subject,email,refresh_encrypted,scope,project_id,project_check)
            VALUES(%s,%s,%s,%s,'cloud-platform','project-fixture',%s)''',
            (user,google.subject,google.email,
             Fernet(config.encryption_key).encrypt(b'fixture-refresh-only').decode(),
             Jsonb({'ready':True})))
        connection.execute('''INSERT INTO uony_model_checks
            (user_id,project_id,google_subject,model,effort)
            VALUES(%s,'project-fixture',%s,'gemini-3.5-flash','medium')''',
            (user,google.subject))
    return user


def test_creative_plan_chat_reentry_scope_and_deletion(environment):
    config,google,db=environment
    planner=Planner()
    with client_for(config,google,cloud=__import__('test_google_cloud').Cloud(),uony=planner) as client:
        user=connect(client,google,db,config)
        body={'requestId':str(uuid4()),'threadId':'creative_test',
              'text':'Prepara un anuncio para mi producto'}
        first=client.post('/api/uony/messages',json=body)
        assert first.status_code==200, first.text
        assert planner.calls==1
        assert 'reseña auténtica' in first.json()['reply']
        assert '0 USD' in first.json()['reply']
        same=client.post('/api/uony/messages',json=body)
        assert same.status_code==200 and planner.calls==1
        saved=client.get('/api/uony/threads/creative_test/creative-plan')
        assert saved.status_code==200
        plan=saved.json()['creativePlan']
        assert plan['recipe']=='review_card'
        assert plan['model']['model']=='gemini-3.1-flash-image'
        assert plan['plan']['modelSnapshot']==plan['model']
        assert plan['plan']['sourceSha256']==plan['sourceSha256']
        assert plan['spendLimitUsd']=='0.00'
        assert plan['productCurrent'] is True
        assert plan['projectCurrent'] is True
        assert len(client.get('/api/uony/threads').json()['threads'][0]['messages'])==2
        with db.connect() as connection:
            rows=connection.execute('SELECT count(*) AS n FROM uony_creative_plans WHERE user_id=%s',
                                    (user,)).fetchone()['n']
            assert rows==1
            connection.execute("UPDATE google_cloud_connections SET project_id='different-project' WHERE user_id=%s",
                               (user,))
        assert client.get('/api/uony/threads/creative_test/creative-plan').json()['creativePlan']['projectCurrent'] is False
        google.subject='another-user'; google.email='other@example.test'; login(client,google)
        assert client.get('/api/uony/threads/creative_test/creative-plan').status_code==403
        with db.connect() as connection:
            other=connection.execute('SELECT id FROM users WHERE google_subject=%s',
                                     (google.subject,)).fetchone()['id']
            connection.execute('UPDATE users SET onboarding_completed_at=now() WHERE id=%s',(other,))
            connection.execute('''INSERT INTO onboarding_profiles(user_id,data) VALUES(%s,%s)''',
                               (other,Jsonb({'ageRange':'25-34','role':'seller'})))
            for document,version in DOCUMENTS.items():
                connection.execute('''INSERT INTO consent_acceptances
                    (user_id,document_id,version) VALUES(%s,%s,%s)''',
                    (other,document,version))
            connection.execute('''INSERT INTO access_periods
                (id,user_id,kind,starts_at,ends_at,source_reference)
                VALUES(%s,%s,'trial',now(),now()+interval '1 day',%s)''',
                (uuid4(),other,'isolation-'+str(uuid4())))
        assert client.get('/api/uony/threads/creative_test/creative-plan').status_code==404
        google.subject='google-test-one';google.email='one@example.test';login(client,google)
        assert client.delete('/api/uony/threads/creative_test').status_code==200
        assert client.get('/api/uony/threads/creative_test/creative-plan').status_code==404
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM uony_creative_plans WHERE user_id=%s',
                                      (user,)).fetchone()['n']==0


def test_video_plan_presents_model_question_in_existing_chat_form(environment):
    config,google,db=environment
    planner=VideoPlanner()
    with client_for(config,google,cloud=__import__('test_google_cloud').Cloud(),uony=planner) as client:
        user=connect(client,google,db,config)
        with db.connect() as connection:
            connection.execute('UPDATE google_cloud_connections SET project_id=%s WHERE user_id=%s',
                               (AUDITED_PROJECT,user))
            connection.execute('''INSERT INTO uony_model_checks
                (user_id,project_id,google_subject,model,effort)
                VALUES(%s,%s,%s,'gemini-3.5-flash','medium')''',
                (user,AUDITED_PROJECT,google.subject))
        answer=client.post('/api/uony/messages',json={'requestId':str(uuid4()),
            'threadId':'video_model_test','text':'Vídeo de una ciudad, desde cero; aún no elijo modelo.'})
        assert answer.status_code==200,answer.text
        assert answer.json()['conversationForm']['fields'][0]['options']==[
            'Veo 3.1 Fast','Veo 3.1','Omni 1.1 Flash']
        assert 'pendiente de tu elección' in answer.json()['reply']
        saved=client.get('/api/uony/threads/video_model_test/creative-plan').json()['creativePlan']
        assert saved['model']['selectionStatus']=='recommendation'
        assert saved['plan']['modelChoice'] is None
        with db.connect() as connection:
            connection.execute('''INSERT INTO uony_threads(user_id,id,title)
                VALUES(%s,'other_goal','Otro encargo')''',(user,))
        unrelated=client.post('/api/uony/assignments',json={
            'requestId':str(uuid4()),'threadId':'other_goal',
            'label':'Producto en Amazon','objective':'Preparar una ficha distinta'})
        assert unrelated.status_code==200,unrelated.text
        returned=client.get('/api/uony/threads/video_model_test/assignment-return')
        assert returned.status_code==200,returned.text
        assert returned.json()['resolution']=='none'
        assert returned.json()['assignments']==[]
        choice={'requestId':str(uuid4()),'threadId':'video_model_test',
                'text':'Elige el modelo de vídeo\n¿Con qué modelo quieres crear este vídeo?: Omni 1.1 Flash'}
        selected=client.post('/api/uony/messages',json=choice)
        assert selected.status_code==200,selected.text
        assert selected.json()['model']=='uonify-creative'
        assert 'Modelo elegido: gemini-omni-1.1-flash-preview' in selected.json()['reply']
        assert selected.json()['conversationForm'] is None
        assert planner.calls==1
        repeated=client.post('/api/uony/messages',json=choice)
        assert repeated.status_code==200 and repeated.json()['reply']==selected.json()['reply']
        assert planner.calls==1
        stored=client.get('/api/uony/threads/video_model_test/creative-plan').json()['creativePlan']
        assert stored['model']['selectionStatus']=='selected'
        assert stored['plan']['modelChoice']=='gemini-omni-1.1-flash-preview'
        assert stored['spendLimitUsd']=='0.00'


def test_recipe_contract_keeps_unverified_or_unsupported_work_visible():
    assert 'imagen-4.0-fast-generate-001' not in {item[1] for item in RECIPES.values()}
    plan=PlanInput.model_validate({'recipe':'reference_video','objective':'Mostrar el uso del producto',
        'audience':'Compradores nuevos','offer':'Demostración del producto'})
    text=response({'recipe':plan.recipe,'model':{'label':'Vídeo con referencias',
        'model':'gemini-omni-1.1-flash-preview','verification':'pendiente de comprobar en este proyecto'},'plan':plan.model_dump(),
        'productBound':False})
    assert 'validación de referencias con Omni' in text
    assert '0 USD' in text
    assert route('ugc_video','another-project')['observedOnProject'] is False
    assert route('ugc_video',AUDITED_PROJECT)['observedOnProject'] is True
    assert route('ugc_video',AUDITED_PROJECT)['observedReferenceInputs'] == ['subject_images']
    assert route('reference_video',AUDITED_PROJECT)['observedReferenceInputs'] == ['image', 'image+video']
    assert 'edit' in route('reference_video',AUDITED_PROJECT)['observedModes']
    assert route('reference_video','another-project')['observedReferenceInputs'] == []
    free_video = PlanInput.model_validate({
        'recipe':'cinematic_video', 'objective':'Una escena de lluvia nocturna en una ciudad',
        'sourceMode':'uony_concept'})
    free_reply = response({'recipe':free_video.recipe,
        'model':route('cinematic_video', AUDITED_PROJECT),
        'plan':free_video.model_dump(), 'productBound':False})
    assert 'propuesta creativa desde cero' in free_reply
    assert 'por diseñar con Uony' in free_reply
    assert 'Oferta:' not in free_reply
    assert 'ficha' not in free_reply
    with __import__('pytest').raises(ValidationError):
        PlanInput.model_validate({'recipe':'product_offer',
            'objective':'Anuncio de un artículo para el hogar',
            'sourceMode':'uony_concept'})


def test_duration_is_not_added_without_a_matching_user_request():
    base={'recipe':'cinematic_video', 'objective':'Una calle nocturna bajo la lluvia',
          'sourceMode':'uony_concept','durationSeconds':15}
    tools=CreativeTools(None,None,'thread','request',None,AUDITED_PROJECT)
    tools.source_texts=['Quiero un vídeo cinematográfico breve, sin producto ni oferta.']
    assert tools.call('prepare_creative_plan',base)['prepared'] is True
    assert tools.prepared['durationSeconds'] is None
    asked=CreativeTools(None,None,'thread','request',None,AUDITED_PROJECT)
    asked.source_texts=['Quiero un vídeo de 15 segundos.']
    assert asked.call('prepare_creative_plan',base)['prepared'] is True
    assert asked.prepared['durationSeconds'] == 15
    corrected=CreativeTools(None,None,'thread','request',None,AUDITED_PROJECT)
    corrected.source_texts=['Quiero un vídeo de 15 segundos.',
                            'No pedí 15 segundos. Deja la duración sin definir.']
    assert corrected.call('prepare_creative_plan',base)['prepared'] is True
    assert corrected.prepared['durationSeconds'] is None
    assert route('cinematic_video',AUDITED_PROJECT)['selectionStatus'] == 'recommendation'
    chosen=PlanInput.model_validate({
        'recipe':'cinematic_video','objective':'Ciudad nocturna bajo la lluvia',
        'sourceMode':'provided','modelChoice':'gemini-omni-1.1-flash-preview',
        'referenceNeeds':[{'role':'motion','kind':'video',
                           'description':'Clip de lluvia aportado'}]})
    selected=route(chosen.recipe,AUDITED_PROJECT,chosen.modelChoice)
    assert selected['model']=='gemini-omni-1.1-flash-preview'
    assert selected['selectionStatus']=='selected'
    chosen_reply=response({'recipe':chosen.recipe,'model':selected,
                           'plan':chosen.model_dump(),'productBound':False})
    assert 'Modelo elegido: gemini-omni-1.1-flash-preview' in chosen_reply
    assert 'elegir el modelo' not in chosen_reply
    with __import__('pytest').raises(ValidationError):
        PlanInput.model_validate({**chosen.model_dump(),
            'modelChoice':'veo-3.1-generate-001'})
    suggested=PlanInput.model_validate(base)
    suggested_reply=response({'recipe':suggested.recipe,
        'model':route(suggested.recipe,AUDITED_PROJECT),
        'plan':suggested.model_dump(),'productBound':False})
    assert 'pendiente de tu elección' in suggested_reply
    assert 'Veo 3.1 Fast, Veo 3.1 u Omni 1.1 Flash' in suggested_reply
    clip_plan=PlanInput.model_validate({
        'recipe':'reference_video','objective':'Guiar una rotación con un clip',
        'sourceMode':'provided','referenceNeeds':[
            {'role':'motion','kind':'video','description':'Clip de rotación del objeto'}]})
    clip_reply=response({'recipe':clip_plan.recipe,
        'model':route(clip_plan.recipe,AUDITED_PROJECT),
        'plan':clip_plan.model_dump(),'productBound':False})
    assert 'la ruta que hemos comprobado es Omni 1.1 Flash' in clip_reply
    assert '¿Con qué modelo' not in clip_reply
    references=PlanInput.model_validate({'recipe':'reference_video',
        'objective':'Mantener el producto reconocible', 'audience':'Compradores nuevos',
        'offer':'Demostración del producto', 'referenceNeeds':[
            {'role':'product','kind':'image','description':'Fotografía real del producto'},
            {'role':'motion','kind':'video','description':'Clip de rotación autorizado'}]})
    reference_reply=response({'recipe':'reference_video',
        'model':route('reference_video',AUDITED_PROJECT),
        'plan':references.model_dump(),'productBound':False})
    assert 'Fotografía real del producto' in reference_reply
    assert 'vincular los archivos reales' in reference_reply
    assert 'validación de referencias con Omni' not in reference_reply
    assert '(producto, imagen)' in reference_reply
    assert '(movimiento, vídeo)' in reference_reply
    for bad in ({'role':'motion','kind':'image','description':'Movimiento imposible'},
                {'role':'first_frame','kind':'video','description':'Primer cuadro inválido'}):
        try:
            PlanInput.model_validate({'recipe':'reference_video',
                'objective':'Mantener el producto reconocible','audience':'Compradores nuevos',
                'offer':'Demostración del producto','referenceNeeds':[bad]})
        except ValidationError:
            pass
        else:
            raise AssertionError('Referencia incompatible aceptada.')
    try:
        PlanInput.model_validate({'recipe':'ugc_video',
            'objective':'Mantener el producto reconocible','audience':'Compradores nuevos',
            'offer':'Demostración del producto','referenceNeeds':[
                {'role':'motion','kind':'video','description':'Clip de movimiento'}]})
    except ValidationError:
        pass
    else:
        raise AssertionError('Veo no admite clips de referencia en esta ruta.')
    try:
        PlanInput.model_validate({'recipe':'ugc_video',
            'objective':'Mantener sujeto reconocible','audience':'Compradores nuevos',
            'offer':'Demostración del producto','referenceNeeds':[
                {'role':'product','kind':'image','description':f'Vista del producto {index}'}
                for index in range(4)]})
    except ValidationError:
        pass
    else:
        raise AssertionError('Veo no admite cuatro imágenes de sujeto.')
    veo=PlanInput.model_validate({'recipe':'ugc_video',
        'objective':'Mostrar un producto real', 'audience':'Compradores nuevos',
        'offer':'Demostración del producto','referenceNeeds':[
            {'role':'product','kind':'image','description':'Foto frontal del producto'}]})
    veo_reply=response({'recipe':'ugc_video','model':route('ugc_video',AUDITED_PROJECT),
        'plan':veo.model_dump(),'productBound':False})
    assert 'Foto frontal del producto' in veo_reply
    assert 'vincular los archivos reales' in veo_reply
    assert 'validación de referencias con Veo' not in veo_reply
    video=PlanInput.model_validate({'recipe':'cinematic_video','objective':'Mostrar el uso del producto',
        'audience':'Compradores nuevos','offer':'Demostración del producto','durationSeconds':30})
    montage=response({'recipe':video.recipe,'model':route(video.recipe,AUDITED_PROJECT),
        'plan':video.model_dump(),'productBound':False})
    assert 'al menos 4 planos' in montage
    try:
        PlanInput.model_validate({'recipe':'product_offer','objective':'Mostrar el uso del producto',
            'audience':'Compradores nuevos','offer':'Demostración del producto','durationSeconds':30})
    except ValidationError:
        pass
    else:
        raise AssertionError('Una imagen no admite duración de vídeo.')


def test_model_choice_requires_customer_selection_or_delegation():
    args={'recipe':'cinematic_video','objective':'Ciudad bajo la lluvia nocturna',
          'sourceMode':'uony_concept','modelChoice':'gemini-omni-1.1-flash-preview'}
    premature=CreativeTools(None,None,'thread','request',None,AUDITED_PROJECT)
    premature.source_texts=['Quiero creatividad desde cero; todavía no he elegido modelo.']
    result=premature.call('prepare_creative_plan',args)
    assert result['error']=='model_not_chosen'
    assert premature.prepared is None
    selected=CreativeTools(None,None,'thread','request',None,AUDITED_PROJECT)
    selected.source_texts=['Quiero creatividad desde cero.', 'Prefiero Omni para este vídeo.']
    assert selected.call('prepare_creative_plan',args)['model']['selectionStatus']=='selected'
    rejected=CreativeTools(None,None,'thread','request',None,AUDITED_PROJECT)
    rejected.source_texts=['No quiero Omni; aún no he elegido modelo.']
    assert rejected.call('prepare_creative_plan',args)['error']=='model_not_chosen'
    delegated=CreativeTools(None,None,'thread','request',None,AUDITED_PROJECT)
    delegated.source_texts=['Elige tú el modelo para este vídeo.']
    assert delegated.call('prepare_creative_plan',args)['prepared'] is True


def test_video_model_uses_existing_chat_choice_form():
    base=PlanInput.model_validate({'recipe':'cinematic_video',
        'objective':'Ciudad nocturna bajo la lluvia', 'sourceMode':'uony_concept'})
    plan={'recipe':base.recipe,'model':route(base.recipe,AUDITED_PROJECT),
          'plan':base.model_dump(),'productBound':False}
    form=model_choice_form(plan)
    assert form['fields'][0]['options']==['Veo 3.1 Fast','Veo 3.1','Omni 1.1 Flash']
    forms=ConversationForms(uuid4())
    assert forms.ask(form)['prepared'] is True
    assert forms.present()['fields'][0]['id']=='video_model'
    assert '¿Con qué modelo' not in response(plan,model_question_visible=False)
    clip=PlanInput.model_validate({'recipe':'reference_video',
        'objective':'Guiar una rotación con un clip', 'sourceMode':'provided',
        'referenceNeeds':[{'role':'motion','kind':'video','description':'Clip de referencia'}]})
    clip_plan={'recipe':clip.recipe,'model':route(clip.recipe,AUDITED_PROJECT),
               'plan':clip.model_dump(),'productBound':False}
    assert model_choice_form(clip_plan)['fields'][0]['options']==['Omni 1.1 Flash']
    chosen=CreativeTools(None,None,'thread','request',None,AUDITED_PROJECT)
    chosen.source_texts=['Elige el modelo de vídeo\n¿Con qué modelo quieres crear este vídeo?: Omni 1.1 Flash']
    assert chosen.call('prepare_creative_plan',{
        'recipe':'cinematic_video','objective':'Ciudad nocturna bajo la lluvia',
        'modelChoice':'gemini-omni-1.1-flash-preview'})['prepared'] is True
