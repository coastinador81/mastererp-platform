"""No media provider is called by these exact-spend ledger tests."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from psycopg.types.json import Jsonb

from conftest import client_for, login
from test_creative_planning import connect
from app.creative_generation_ledger import (CompleteCost, approve_exact,
    issue_complete_quote, mark_unknown, reserve_once)
import app.creative_generation_ledger as ledger
from app.creative_image_contracts import ImageMedia, image_request


def _setup(environment):
    config, google, db = environment
    client_context = client_for(config, google, cloud=__import__('test_google_cloud').Cloud())
    client = client_context.__enter__()
    user_id = connect(client, google, db, config)
    plan_id, thread_id = uuid4(), 'creative-spend-test'
    with db.connect() as c:
        c.execute('''UPDATE google_cloud_connections
            SET project_check=%s WHERE user_id=%s''',
            (Jsonb({'ready': True, 'billing': 'enabled',
                    'vertex': 'enabled', 'permissions': 'enabled'}), user_id))
        c.execute('''INSERT INTO uony_threads(user_id,id,title)
            VALUES(%s,%s,'Creativo de prueba')''', (user_id, thread_id))
        c.execute('''INSERT INTO uony_creative_plans
            (user_id,id,google_subject,project_id,thread_id,origin_request_id,
             skill_version,recipe,plan)
            VALUES(%s,%s,%s,'project-fixture',%s,%s,'test-v1',
                   'product_diagram',%s)''',
            (user_id, plan_id, google.subject, thread_id, uuid4(),
             Jsonb({'objective':'Crear diagrama de producto de prueba',
                    'modelSnapshot':{'model':'gemini-3.1-flash-image',
                                     'medium':'imagen'}})))
    return client_context, client, db, google, user_id, plan_id, thread_id


def _cost(*, complete=True, components=None):
    now = datetime.now(timezone.utc)
    return CompleteCost(components or {
        'generation': Decimal('0.20'), 'storage': Decimal('0.03'),
        'processing': Decimal('0.02'), 'transfer': Decimal('0.01')},
        Decimal('0.30'), 'a' * 64, now - timedelta(minutes=1),
        now + timedelta(hours=1), complete)


def _request():
    return image_request('project-fixture', 'gemini-3.1-flash-image',
                         'Una ilustración de prueba')


def _quote(db, user_id, plan_id, *, cost=None, request=None):
    with db.connect() as c:
        user = c.execute('SELECT * FROM users WHERE id=%s', (user_id,)).fetchone()
        return issue_complete_quote(c, user, plan_id, uuid4(),
                                    request or _request(), cost or _cost())


def _body(quote, request_id=None):
    return {'requestId': str(request_id or uuid4()), 'quoteId': quote['quoteId'],
            'quoteSha256': quote['quoteSha256'],
            'planRevision': quote['planRevision'],
            'planSha256': quote['planSha256'],
            'requestSha256': quote['requestSha256'],
            'maxTotalUsd': quote['maxTotalUsd'],
            'acknowledgeExactMaximum': True}


def _approve(client, thread_id, quote, request_id=None):
    body = _body(quote, request_id)
    response = client.post(f'/api/uony/threads/{thread_id}/creative-generation/approvals',
                           json=body)
    assert response.status_code == 200, response.text
    return response.json(), body


def test_exact_quote_approval_and_one_reservation(environment, monkeypatch):
    context, client, db, _, user_id, plan_id, thread_id = _setup(environment)
    try:
        quote = _quote(db, user_id, plan_id)
        assert quote['payer'] == 'customer_google_project'
        assert quote['maxTotalUsd'] == '0.30'
        assert quote['sourceCurrent'] is True
        base = f'/api/uony/threads/{thread_id}/creative-generation'
        shown = client.get(base + '/quotes/' + quote['quoteId'])
        assert shown.status_code == 200 and shown.json()['quoteSha256'] == quote['quoteSha256']
        not_approved = client.post(base + '/approvals',
            json={**_body(quote), 'acknowledgeExactMaximum': False})
        assert not_approved.status_code == 422
        approval, body = _approve(client, thread_id, quote)
        assert approval['generationStarted'] is False
        assert client.post(base + '/approvals', json=body).json() == approval
        assert client.get(base + '/approvals/' + approval['approvalId']).status_code == 200
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE id=%s', (user_id,)).fetchone()
            with pytest.raises(HTTPException) as disabled:
                reserve_once(c, user, UUID(approval['approvalId']), uuid4())
            assert disabled.value.detail['error'] == 'creative_generation_disabled'
            with pytest.raises(HTTPException) as still_disabled:
                reserve_once(c, user, UUID(approval['approvalId']), uuid4(), gate_open=True)
            assert still_disabled.value.detail['error'] == 'creative_generation_disabled'
            monkeypatch.setattr(ledger, 'PRODUCTION_DISPATCH_ENABLED', True)
            attempt_request = uuid4()
            first, created = reserve_once(c, user, UUID(approval['approvalId']),
                                           attempt_request, gate_open=True)
            assert created is True and first['status'] == 'reserved'
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE id=%s', (user_id,)).fetchone()
            same, created = reserve_once(c, user, UUID(approval['approvalId']),
                                         attempt_request, gate_open=False)
            assert same == first and created is False
            with pytest.raises(HTTPException) as duplicate:
                reserve_once(c, user, UUID(approval['approvalId']), uuid4(), gate_open=True)
            assert duplicate.value.detail['error'] == 'creative_approval_already_used'
            unknown = mark_unknown(c, user_id, UUID(first['attemptId']))
            assert unknown['status'] == 'unknown'
            replay, created = reserve_once(c, user, UUID(approval['approvalId']),
                                           attempt_request, gate_open=False)
            assert replay == unknown and created is False
            assert c.execute('''SELECT count(*) AS n FROM creative_generation_attempts
                WHERE user_id=%s''', (user_id,)).fetchone()['n'] == 1
    finally:
        context.__exit__(None, None, None)


def test_quote_request_id_cannot_be_reused_for_changed_body(environment):
    context, _, db, _, user_id, plan_id, _ = _setup(environment)
    try:
        issue_request = uuid4()
        fixed_cost = _cost()
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE id=%s', (user_id,)).fetchone()
            first = issue_complete_quote(c, user, plan_id, issue_request,
                                         _request(), fixed_cost)
            assert issue_complete_quote(c, user, plan_id, issue_request,
                                        _request(), fixed_cost) == first
            changed = image_request('project-fixture', 'gemini-3.1-flash-image',
                                    'Una ilustración de prueba diferente')
            with pytest.raises(HTTPException) as conflict:
                issue_complete_quote(c, user, plan_id, issue_request,
                                     changed, fixed_cost)
            assert conflict.value.detail['error'] == 'creative_quote_request_conflict'
    finally:
        context.__exit__(None, None, None)


def test_stale_revision_request_hash_and_project_rejected(environment):
    context, client, db, _, user_id, plan_id, thread_id = _setup(environment)
    try:
        quote = _quote(db, user_id, plan_id)
        url = f'/api/uony/threads/{thread_id}/creative-generation/approvals'
        changed_hash = client.post(url, json={**_body(quote), 'requestSha256':'f'*64})
        assert changed_hash.status_code == 409
        with db.connect() as c:
            c.execute('''UPDATE uony_creative_plans SET revision=revision+1
                WHERE user_id=%s AND id=%s''', (user_id, plan_id))
        stale = client.post(url, json=_body(quote))
        assert stale.status_code == 409
        assert stale.json()['error'] == 'creative_quote_stale'
        with db.connect() as c:
            c.execute('''UPDATE uony_creative_plans SET revision=revision-1
                WHERE user_id=%s AND id=%s''', (user_id, plan_id))
            c.execute('''UPDATE google_cloud_connections SET project_id='other-project'
                WHERE user_id=%s''', (user_id,))
        changed_payer = client.post(url, json=_body(quote))
        assert changed_payer.status_code == 409
        with db.connect() as c:
            c.execute('''UPDATE google_cloud_connections SET project_id='project-fixture'
                WHERE user_id=%s''', (user_id,))
            project_id = uuid4()
            c.execute('''INSERT INTO uony_projects(user_id,id,name)
                VALUES(%s,%s,'Otro proyecto')''', (user_id, project_id))
            c.execute('''UPDATE uony_threads SET project_id=%s
                WHERE user_id=%s AND id=%s''', (project_id, user_id, thread_id))
        changed_project = client.post(url, json=_body(quote))
        assert changed_project.status_code == 409
        assert changed_project.json()['error'] == 'creative_quote_stale'
    finally:
        context.__exit__(None, None, None)


def test_other_user_cannot_read_or_approve(environment):
    context, client, db, google, user_id, plan_id, thread_id = _setup(environment)
    try:
        quote = _quote(db, user_id, plan_id)
        google.subject = 'creative-other-user'
        google.email = 'other-creative@example.test'
        login(client, google)
        base = f'/api/uony/threads/{thread_id}/creative-generation'
        read = client.get(base + '/quotes/' + quote['quoteId'])
        assert read.status_code in (403, 404)
        approve = client.post(base + '/approvals', json=_body(quote))
        assert approve.status_code in (403, 404)
        with db.connect() as c:
            assert c.execute('''SELECT count(*) AS n FROM creative_generation_approvals
                WHERE user_id=%s''', (user_id,)).fetchone()['n'] == 0
    finally:
        context.__exit__(None, None, None)


def test_no_quote_without_full_price_or_owned_assets(environment):
    context, _, db, _, user_id, plan_id, _ = _setup(environment)
    try:
        with db.connect() as c:
            user = c.execute('SELECT * FROM users WHERE id=%s', (user_id,)).fetchone()
            with pytest.raises(HTTPException) as missing:
                issue_complete_quote(c, user, plan_id, uuid4(), _request(), None)
            assert missing.value.detail['error'] == 'creative_full_price_missing'
            with pytest.raises(HTTPException) as partial:
                issue_complete_quote(c, user, plan_id, uuid4(), _request(),
                                     _cost(complete=False))
            assert partial.value.detail['error'] == 'creative_full_price_missing'
            with pytest.raises(HTTPException) as incomplete:
                issue_complete_quote(c, user, plan_id, uuid4(), _request(),
                                     _cost(components={'generation': Decimal('0.20')}))
            assert incomplete.value.detail['error'] == 'creative_full_price_missing'
            media = ImageMedia('image/png', b'\x89PNG\r\n\x1a\nfixture')
            referenced = image_request('project-fixture', 'gemini-3.1-flash-image',
                                       'Una imagen con referencia', media)
            with pytest.raises(HTTPException) as assets:
                issue_complete_quote(c, user, plan_id, uuid4(), referenced, _cost())
            assert assets.value.detail['error'] == 'creative_assets_unverified'
            assert c.execute('SELECT count(*) AS n FROM creative_generation_quotes').fetchone()['n'] == 0
    finally:
        context.__exit__(None, None, None)
