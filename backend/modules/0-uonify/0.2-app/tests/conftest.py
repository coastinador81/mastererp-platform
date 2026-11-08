from dataclasses import replace
from uuid import uuid4
from contextlib import contextmanager
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from httpx import Response
from psycopg import sql
from app.settings import load_settings
from app.database import Database
from app.main import create_app


class Provider:
    def __init__(self):
        self.state = ''
        self.fail = False
        self.subject = 'google-test-one'
        self.email = 'one@example.test'

    def authorization_url(self, state, nonce, verifier):
        self.state = state
        self.nonce = nonce
        self.verifier = verifier
        return 'https://accounts.google.com/o/oauth2/v2/auth?state=' + state

    def identity(self, code, nonce, verifier):
        assert nonce == self.nonce and verifier == self.verifier
        if self.fail:
            raise ValueError('Provider unavailable')
        return {'sub': self.subject, 'email': self.email, 'name': 'Persona de prueba'}


@pytest.fixture
def environment():
    base = load_settings()
    schema = 'test_' + uuid4().hex
    admin = Database(base.database)
    with admin.connect() as connection:
        connection.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
    config = replace(base, database={**base.database, 'options': '-csearch_path=' + schema},
                     secrets_directory='/nonexistent-uonify-tests',
                     encryption_key=Fernet.generate_key(), google_client_id='test-client',
                     google_client_secret='test-only',
                     adk_pilot_user_ids=(), material_adk_pilot_user_ids=(),
                     live_pilot_user_ids=(), live_pilot_session_limit=None)
    provider = Provider()
    database = Database(config.database)
    try:
        yield config, provider, database
    finally:
        with admin.connect() as connection:
            connection.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))


@contextmanager
def client_for(config, provider, stripe=None, cloud=None, drive=None, uony=None, amazon=None, incidents=None, requirements=None, legacy_sync=True):
    with TestClient(create_app(config, provider, stripe, cloud, drive, uony, amazon, incidents, requirements), base_url=config.origin, follow_redirects=False) as client:
        client.headers['Origin'] = config.origin
        yield LegacyConversationClient(client) if legacy_sync else client


class LegacyConversationClient:
    """Keep older business assertions focused on final results; async API has separate tests."""
    def __init__(self, client):
        self._client=client
        self._failed_legacy_requests=set()

    def __getattr__(self, name):
        return getattr(self._client,name)

    def post(self, url, *args, **kwargs):
        request_id=(kwargs.get('json') or {}).get('requestId') if url=='/api/uony/messages' else None
        if request_id in self._failed_legacy_requests:
            return Response(409,json={'error':'already_attempted','message':'Este intento ya se inició.'},
                            request=self._client.build_request('POST',url))
        response=self._client.post(url,*args,**kwargs)
        if url!='/api/uony/messages' or response.status_code not in (200,202):
            return response
        if response.status_code==200 and response.json().get('status')=='success':
            return Response(200,json=response.json()['response'],request=response.request)
        if response.status_code!=202:
            return response
        worker=self._client.app.state.conversation_worker
        job=worker.queue.claim('legacy-test-fixture')
        if job:
            worker.run(job)
        state=self._client.get(response.json()['pollUrl']).json()
        if state['status']=='success':
            return Response(200,json=state['response'],request=response.request)
        if state['status'] in ('error','unknown','cancelled'):
            self._failed_legacy_requests.add(request_id)
            failure=state['error']
            code=failure['code']
            status=409 if code in ('product_conflict','product_memory_conflict','google_changed','model_changed') else 503
            public={'error':code,'message':failure['message']}
            if state.get('connectionActions'):
                public['connectionActions']=state['connectionActions']
            return Response(status,json=public,request=response.request)
        return response


def login(client, provider):
    response = client.post('/api/auth/google/start', json={'returnTo': str(client.base_url).rstrip('/') + '/?auth=return'})
    assert response.status_code == 200
    return client.get('/api/auth/google/callback', params={'code': 'test-only', 'state': provider.state})
