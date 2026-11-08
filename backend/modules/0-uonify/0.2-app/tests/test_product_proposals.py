"""Model product changes need a separate customer decision; never call Google/Amazon."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4
from unittest.mock import patch

from psycopg.errors import LockNotAvailable

from conftest import client_for, login
from test_google_cloud import Cloud
from test_products import connect
from test_uony import ready


class Agent:
    def generate(self, token, project, history, tools, **kwargs):
        text = history[-1]['parts'][0]['text'].lower()
        if 'sigue' in text:
            assert tools['productMemory']['product']['sku'] == 'BASIC-01'
            assert tools.call('get_product', {'sku': 'BASIC-01'})['product']['revision'] == 1
            return 'Seguimos con Basic Mini Bricks.', {'calls': 1, 'attemptedCalls': 1,
                'totalTokenCount': 12}
        if 'edita' in text:
            product = tools.call('get_product', {'sku': 'BASIC-01'})['product']
            assert tools.call('update_product', {'sku': 'BASIC-01',
                'revision': product['revision'], 'changes': {'brand': 'Marca propuesta'}})['prepared']
        else:
            assert tools.call('create_product', {'sku': 'BASIC-01',
                'name': 'Basic Mini Bricks'})['prepared']
        # The model's premature claim must be replaced with the actual state.
        return 'Ya guardé la ficha.', {'calls': 1, 'attemptedCalls': 1, 'totalTokenCount': 12}


def propose(client, thread='basic', text='Prepara Basic Mini Bricks'):
    request = {'requestId': str(uuid4()), 'threadId': thread, 'text': text}
    response = client.post('/api/uony/messages', json=request)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['productChanges'] == []
    assert result['productProposal']['status'] == 'pending'
    assert 'sigue sin cambios' in result['reply']
    return result['productProposal']


def decision(proposal, action='approve', request_id=None):
    return {'threadId': proposal['threadId'], 'requestId': request_id or str(uuid4()),
            'proposalHash': proposal['proposalHash'],
            'baseRevision': proposal['baseRevision'], 'action': action}


def url(proposal):
    return '/api/uony/product-proposals/' + proposal['proposalId']


def test_create_requires_approval_replays_once_and_binds_to_same_thread(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=Agent()) as client:
        ready(client, google, db)
        connect(db, config)
        with patch('app.amazon_listings_provider.httpx.Client.put') as amazon_put:
            proposal = propose(client)
            assert client.get('/api/products').json()['products'] == []
            assert client.get(url(proposal), params={'threadId': 'basic'}).json() == proposal
            assert client.get(url(proposal), params={'threadId': 'other'}).status_code == 404
            body = decision(proposal)
            assert client.post(url(proposal) + '/decision', json=body,
                headers={'Origin': 'null'}).status_code == 403
            assert client.post(url(proposal) + '/decision', json={**body,
                'threadId': 'other'}).status_code == 404
            approved = client.post(url(proposal) + '/decision', json=body)
            assert approved.status_code == 200, approved.text
            result = approved.json()
            assert result['status'] == 'approved'
            assert result['linkedProduct']['sku'] == 'BASIC-01'
            assert len(result['productChanges']) == 1
            product = client.get('/api/products').json()['products'][0]
            assert product == result['productChanges'][0]['product']
            assert client.post(url(proposal) + '/decision', json=body).json() == result
            assert len(client.get('/api/products').json()['products']) == 1
            assert client.post(url(proposal) + '/decision', json=decision(proposal)).status_code == 409
            # A lost HTTP response stays recoverable even if the Google project
            # or subscription changes after the single committed approval.
            with db.connect() as c:
                c.execute("UPDATE google_cloud_connections SET project_id='other-project'")
            assert client.post(url(proposal) + '/decision', json=body).json() == result
            with db.connect() as c:
                c.execute("UPDATE google_cloud_connections SET project_id='project-fixture'")
                c.execute('UPDATE access_periods SET ends_at=now()')
            assert client.post(url(proposal) + '/decision', json=body).json() == result
            with db.connect() as c:
                c.execute("UPDATE access_periods SET ends_at=now()+interval '1 day'")
            history = client.get('/api/uony/threads').json()['threads'][0]['messages'][-1]
            assert history['productProposal']['status'] == 'approved'
            assert client.get(url(proposal), params={'threadId': 'basic'}).json()['status'] == 'approved'
            continued = client.post('/api/uony/messages', json={'requestId': str(uuid4()),
                'threadId': 'basic', 'text': 'Sigue con este producto'})
            assert continued.status_code == 200, continued.text
            assert continued.json()['productChanges'] == []
            assert 'productProposal' not in continued.json()
            with db.connect() as c:
                assert c.execute('SELECT count(*) n FROM product_revisions').fetchone()['n'] == 1
                assert c.execute('SELECT count(*) n FROM uony_thread_products').fetchone()['n'] == 1
            amazon_put.assert_not_called()


def test_edit_rejects_stale_revision_then_can_approve_fresh_proposal(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=Agent()) as client:
        ready(client, google, db)
        connect(db, config)
        original = client.post('/api/products', json={'sku': 'BASIC-01',
            'name': 'Basic Mini Bricks'}).json()['product']
        stale = propose(client, text='Edita la marca de Basic Mini Bricks')
        assert stale['baseRevision'] == 1
        assert client.get('/api/products').json()['products'][0] == original
        revised = client.patch('/api/products/BASIC-01', json={'revision': 1,
            'description': 'Revisión manual'}).json()['product']
        conflict = client.post(url(stale) + '/decision', json=decision(stale))
        assert conflict.status_code == 409
        assert conflict.json()['error'] == 'product_conflict'
        assert client.get('/api/products').json()['products'][0] == revised
        fresh = propose(client, text='Edita ahora la marca de Basic Mini Bricks')
        assert fresh['baseRevision'] == 2
        approved = client.post(url(fresh) + '/decision', json=decision(fresh))
        assert approved.status_code == 200, approved.text
        final = client.get('/api/products').json()['products'][0]
        assert final['id'] == original['id'] and final['revision'] == 3
        assert final['brand'] == 'Marca propuesta'
        assert approved.json()['linkedProduct']['sku'] == 'BASIC-01'


def test_update_cannot_target_a_recreated_product_with_same_sku_revision(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=Agent()) as client:
        ready(client, google, db)
        connect(db, config)
        old = client.post('/api/products', json={'sku': 'BASIC-01',
            'name': 'Producto original'}).json()['product']
        proposal = propose(client, thread='unlinked-edit', text='Edita la marca de BASIC-01')
        assert proposal['targetProductId'] == old['id']
        assert proposal['threadLinkVersion'] == 0 and proposal['baseRevision'] == 1
        assert client.delete('/api/products/BASIC-01').status_code == 200
        replacement = client.post('/api/products', json={'sku': 'BASIC-01',
            'name': 'Producto distinto'}).json()['product']
        assert replacement['id'] != old['id'] and replacement['revision'] == 1
        blocked = client.post(url(proposal) + '/decision', json=decision(proposal))
        assert blocked.status_code == 409 and blocked.json()['error'] == 'product_conflict'
        assert client.get('/api/products').json()['products'] == [replacement]


def test_create_proposal_cannot_ignore_a_deleted_intervening_thread_focus(environment):
    from app.product_memory import bind
    from app.products import find

    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=Agent()) as client:
        ready(client, google, db)
        connect(db, config)
        proposal = propose(client, thread='focus-aba')
        assert proposal['threadLinkVersion'] == 0
        assert client.get('/api/products').json()['products'] == []
        client.post('/api/products', json={'sku': 'OTHER', 'name': 'Otra ficha'})
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            bind(c, user, 'focus-aba', find(c, user, 'OTHER'), 'conversation', 0)
        assert client.delete('/api/products/OTHER').status_code == 200
        # The link row is gone, so its version appears to return to zero. The
        # older proposal must still be stale rather than creating a new SKU.
        blocked = client.post(url(proposal) + '/decision', json=decision(proposal))
        assert blocked.status_code == 409 and blocked.json()['error'] == 'product_link_conflict'
        assert client.get('/api/products').json()['products'] == []


def test_create_proposal_after_focus_deletion_uses_current_cutoff(environment):
    from app.product_memory import bind
    from app.products import find

    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=Agent()) as client:
        ready(client, google, db)
        connect(db, config)
        client.post('/api/products', json={'sku': 'OTHER', 'name': 'Otra ficha'})
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'after-delete','Otra ficha')",
                      (user['id'],))
            bind(c, user, 'after-delete', find(c, user, 'OTHER'), 'conversation', 0)
        assert client.delete('/api/products/OTHER').status_code == 200
        proposal = propose(client, thread='after-delete')
        approved = client.post(url(proposal) + '/decision', json=decision(proposal))
        assert approved.status_code == 200, approved.text
        assert approved.json()['linkedProduct']['sku'] == 'BASIC-01'


def test_approval_locks_thread_against_concurrent_focus_cutoff_aba(environment, monkeypatch):
    """A focus deletion cannot erase its link after approval reads the cutoff."""
    import app.product_proposals as proposals
    from app.product_memory import bind
    from app.products import find

    config, google, db = environment
    read, release = Event(), Event()
    original_owned = proposals._owned

    def pause_after_read(c, user, thread_id, proposal_id, *, lock=False):
        row = original_owned(c, user, thread_id, proposal_id, lock=lock)
        if lock:
            read.set()
            assert release.wait(10)
        return row

    monkeypatch.setattr(proposals, '_owned', pause_after_read)
    with client_for(config, google, cloud=Cloud(), uony=Agent()) as client:
        ready(client, google, db)
        connect(db, config)
        proposal = propose(client, thread='focus-concurrent-aba')
        assert client.post('/api/products', json={'sku': 'OTHER',
            'name': 'Otra ficha'}).status_code == 200
        with db.connect() as c:
            user = c.execute('SELECT * FROM users').fetchone()
            bind(c, user, 'focus-concurrent-aba', find(c, user, 'OTHER'),
                 'conversation', 0)
            user_id = user['id']

        def erase_focus():
            with db.connect() as c:
                c.execute("SET LOCAL lock_timeout='600ms'")
                c.execute('''UPDATE uony_threads SET product_history_cutoff_at=clock_timestamp()
                    WHERE user_id=%s AND id='focus-concurrent-aba' ''', (user_id,))
                c.execute('''DELETE FROM uony_thread_products
                    WHERE user_id=%s AND thread_id='focus-concurrent-aba' ''', (user_id,))

        with ThreadPoolExecutor(max_workers=2) as pool:
            approval = pool.submit(client.post, url(proposal) + '/decision',
                                   json=decision(proposal))
            assert read.wait(10)
            try:
                erase = pool.submit(erase_focus)
                try:
                    erase.result(timeout=5)
                    focus_change_was_blocked = False
                except LockNotAvailable:
                    focus_change_was_blocked = True
            finally:
                release.set()
            response = approval.result(timeout=10)
        assert focus_change_was_blocked
        assert response.status_code == 409
        assert response.json()['error'] == 'product_link_conflict'
        assert [item['sku'] for item in client.get('/api/products').json()['products']] == ['OTHER']


def test_proposal_is_bound_to_identity_project_and_live_thread(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=Agent()) as client:
        ready(client, google, db)
        connect(db, config)
        proposal = propose(client)
        body = decision(proposal)
        google.subject = 'another-user'
        google.email = 'other@example.test'
        login(client, google)
        assert client.get(url(proposal), params={'threadId': 'basic'}).status_code == 404
        assert client.post(url(proposal) + '/decision', json=body).status_code in (403, 404)
        google.subject = 'google-test-one'
        google.email = 'one@example.test'
        login(client, google)
        with db.connect() as c:
            c.execute("UPDATE google_cloud_connections SET project_id='another-project'")
        changed = client.post(url(proposal) + '/decision', json=body)
        assert changed.status_code == 409 and changed.json()['error'] == 'google_changed'
        with db.connect() as c:
            c.execute("UPDATE google_cloud_connections SET project_id='project-fixture'")
        assert client.delete('/api/uony/threads/basic').status_code == 200
        assert client.post(url(proposal) + '/decision', json=body).status_code == 404
        assert client.get('/api/products').json()['products'] == []


def test_reject_or_cancel_does_not_save_and_cannot_be_reused(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=Agent()) as client:
        ready(client, google, db)
        connect(db, config)
        for action in ('reject', 'cancel'):
            proposal = propose(client, thread=action)
            body = decision(proposal, action)
            first = client.post(url(proposal) + '/decision', json=body)
            assert first.status_code == 200 and first.json()['status'] in ('rejected', 'cancelled')
            assert client.post(url(proposal) + '/decision', json=body).json() == first.json()
            assert client.post(url(proposal) + '/decision',
                json=decision(proposal)).status_code == 409
        assert client.get('/api/products').json()['products'] == []
