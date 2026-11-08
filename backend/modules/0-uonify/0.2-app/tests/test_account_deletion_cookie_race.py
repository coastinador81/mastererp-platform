"""Una respuesta tardía del borrado de A no elimina la cookie de la cuenta B."""
from conftest import client_for, login
from app.security import SESSION_COOKIE


def test_replayed_deletion_does_not_clear_a_later_login(environment):
    config, google, _ = environment
    with client_for(config, google) as client:
        login(client, google)
        original = client.cookies.get(SESSION_COOKIE)
        state = client.get('/api/account/deletion').json()
        body = {'requestId': state['requestId'], 'email': state['email'], 'confirmation': 'ELIMINAR'}
        deleted = client.post('/api/account/deletion', json=body)
        assert deleted.json()['status'] == 'deleted' and 'set-cookie' not in deleted.headers
        google.subject, google.email = 'second-identity', 'second@example.test'
        login(client, google)
        following = client.cookies.get(SESSION_COOKIE)
        assert following and following != original
        # This request started with A's cookie, but its late response reaches a
        # browser whose cookie jar already contains the newer login of B.
        replay = client.post('/api/account/deletion', json=body,
                             headers={'Cookie': SESSION_COOKIE + '=' + original})
        assert replay.json()['status'] == 'deleted' and 'set-cookie' not in replay.headers
        assert client.cookies.get(SESSION_COOKIE) == following
        session = client.get('/api/auth/session').json()
        assert session['authenticated'] is True and session['email'] == google.email
