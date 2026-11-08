"""The public selector describes platform configuration, never account access."""
from types import SimpleNamespace
from typing import get_args
from uuid import uuid4
from unittest.mock import patch
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from conftest import client_for
from app.uony_models import EFFORTS, MODELS, POLICY, Effort, Preferences
from app.uony_provider import request_payload
from app.uony_routes import routes


class NoAccess:
    def __getattr__(self, name):
        raise AssertionError('Public catalog must not access database or providers: '+name)


def catalog_client():
    app=FastAPI()
    settings=SimpleNamespace(encryption_key=Fernet.generate_key(),origin='http://testserver')
    app.include_router(routes(settings,NoAccess(),NoAccess(),NoAccess()))
    return TestClient(app)


def test_public_catalog_needs_no_session_database_or_provider_and_discloses_no_account_state():
    with catalog_client() as client:
        response=client.get('/api/uony/catalog')
        assert response.status_code == 200
        data=response.json()
        assert set(data) == {'models','efforts','preferences','autoPolicy','scope','requiresAccountVerification'}
        assert data['scope'] == 'platform' and data['requiresAccountVerification'] is True
        assert data['preferences'] == {'model':'auto','effort':'medium'}
        assert data['autoPolicy'] == POLICY
        assert data['efforts'] == EFFORTS
        assert [{k:v for k,v in model.items() if k!='efforts'} for model in data['models']] == MODELS
        client.cookies.set('uonify_session','an-unrelated-or-invalid-session')
        assert client.get('/api/uony/catalog').json() == data
        assert client.post('/api/uony/catalog',json={'model':'auto'}).status_code == 405


def test_published_choices_are_accepted_by_preferences_and_encode_supported_thinking_levels():
    with catalog_client() as client:
        data=client.get('/api/uony/catalog').json()
    for model in data['models']:
        assert set(model['efforts']) == set(get_args(Effort))
        for effort in model['efforts']:
            selection=Preferences(model=model['id'],effort=effort)
            config=request_payload([],{},selection.effort)['generationConfig']
            assert config['thinkingConfig'] == {'thinkingLevel':effort.upper()}


def test_catalog_uses_server_metadata_rather_than_a_separate_hardcoded_copy():
    with patch('app.uony_routes.MODELS',[{**MODELS[0],'label':'Etiqueta canónica actualizada'}]):
        with catalog_client() as client:
            data=client.get('/api/uony/catalog').json()
    assert len(data['models']) == 1
    assert data['models'][0]['label'] == 'Etiqueta canónica actualizada'


def test_public_read_does_not_grant_private_preferences_chat_or_access(environment):
    config,google,database=environment
    with client_for(config,google,cloud=NoAccess(),uony=NoAccess()) as client:
        assert client.get('/api/uony/catalog').status_code == 200
        assert client.get('/api/uony/options').status_code == 401
        assert client.put('/api/uony/preferences',json={'model':'auto','effort':'medium'}).status_code == 401
        body={'requestId':str(uuid4()),'threadId':'public-no-access','text':'Hola'}
        assert client.post('/api/uony/messages',json=body).status_code == 401
    with database.connect() as connection:
        for table in ('users','access_periods','billing_checkouts','uony_requests'):
            assert connection.execute('SELECT count(*) AS n FROM '+table).fetchone()['n'] == 0
