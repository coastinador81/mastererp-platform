from app.onboarding import DOCUMENTS
from app.security import SESSION_COOKIE
from conftest import client_for, login

TERMS = {'consents': [{'id': key, 'version': version} for key, version in DOCUMENTS.items()]}
PERSON = {'firstName': ' Ana ', 'lastName': 'García', 'ageRange': '25-34'}
WORK = {'role': 'seller', 'companySize': '1', 'company': ' Mi empresa ', 'primaryGoal': 'catalog', 'source': ''}


def test_resume_restart_edit_idempotence_and_no_workspace_access(environment):
    config, provider, db = environment
    with client_for(config, provider) as client:
        login(client, provider)
        cookie = client.cookies.get(SESSION_COOKIE)
        accepted = client.post('/api/onboarding/terms', json=TERMS).json()
        assert accepted['onboarding']['step'] == 'you'
        assert len(accepted['consents']) == 3
        assert client.post('/api/onboarding/terms', json=TERMS).json()['consents'] == accepted['consents']
        saved = client.post('/api/onboarding/you', json=PERSON).json()
        assert saved['profile']['firstName'] == 'Ana'
        assert saved['onboarding']['step'] == 'work'
    with client_for(config, provider) as client:
        client.cookies.set(SESSION_COOKIE, cookie)
        assert client.get('/api/auth/session').json()['onboarding']['step'] == 'work'
        result = client.post('/api/onboarding/work', json=WORK).json()
        assert result['onboarding']['step'] == 'pending'
        assert result['profileComplete'] is False
        assert result['profile']['company'] == 'Mi empresa'
        # Editar datos previos no borra el trabajo ni vuelve a aceptar las condiciones.
        client.post('/api/onboarding/you', json={**PERSON, 'firstName': 'María'})
        session = client.get('/api/auth/session').json()
        assert session['profile']['firstName'] == 'María' and session['profile']['role'] == 'seller'
        assert session['consents'] == accepted['consents']
        assert session['profileComplete'] is False and session['chatgptPlan']['status'] == 'not_connected'
        client.post('/api/auth/logout')
        login(client, provider)
        assert client.get('/api/auth/session').json()['onboarding']['step'] == 'pending'
        with db.connect() as connection:
            assert connection.execute('SELECT count(*) AS n FROM consent_acceptances').fetchone()['n'] == 3


def test_validation_order_origin_expiry_and_account_isolation(environment):
    config, provider, db = environment
    with client_for(config, provider) as one, client_for(config, provider) as two:
        assert one.post('/api/onboarding/you', json=PERSON).status_code == 401
        login(one, provider)
        assert one.post('/api/onboarding/you', json=PERSON).status_code == 409
        assert one.post('/api/onboarding/terms', json=TERMS, headers={'Origin': 'https://evil.test'}).status_code == 403
        assert one.post('/api/onboarding/terms', json={'consents': TERMS['consents'][:2]}).status_code == 400
        assert one.post('/api/onboarding/terms', json={'consents': [TERMS['consents'][0]] * 3}).status_code == 409
        assert one.post('/api/onboarding/terms', json={'consents': [{**item, 'version': 'old'} for item in TERMS['consents']]}).status_code == 409
        assert one.post('/api/onboarding/terms', json=TERMS).status_code == 200
        assert one.post('/api/onboarding/work', json=WORK).status_code == 409
        for invalid in [{'ageRange': 'under18'}, {'firstName': ' '}, {'firstName': 'x' * 61}, {'email': 'other@example.test'}, {'user_id': 'someone'}, {'profileComplete': True}]:
            assert one.post('/api/onboarding/you', json={**PERSON, **invalid}).status_code == 400
        assert one.post('/api/onboarding/you', json=PERSON).status_code == 200
        assert one.post('/api/onboarding/work', json={**WORK, 'role': 'invalid'}).status_code == 400
        assert one.post('/api/onboarding/work', json={**WORK, 'company': 'x' * 101}).status_code == 400
        provider.subject = 'second-person'
        login(two, provider)
        session = two.get('/api/auth/session').json()
        assert session['profile'] is None and session['consents'] == []
        assert session['onboarding']['step'] == 'terms'
        with db.connect() as connection:
            connection.execute("UPDATE sessions SET expires_at=now()-interval '1 second'")
        assert one.post('/api/onboarding/work', json=WORK).status_code == 401
