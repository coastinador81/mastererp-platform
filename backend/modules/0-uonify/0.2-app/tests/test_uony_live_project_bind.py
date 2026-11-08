"""Workspace-project binding for local Live sockets; no paid provider calls."""
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import create_app
from app.uony_live_bridge import LiveIdentity, _bind
from test_uony_live_bridge import FakeLive, account_setup, headers


def test_live_bind_preserves_project_and_rejects_foreign_or_changed_project(environment):
    config, provider, db = environment
    first, second = account_setup(config, provider, db)
    own_project, foreign_project = uuid4(), uuid4()
    with db.connect() as c:
        c.execute("INSERT INTO uony_projects(user_id,id,name) VALUES(%s,%s,'1er producto')",
                  (first[0], own_project))
        c.execute("INSERT INTO uony_projects(user_id,id,name) VALUES(%s,%s,'Otro cliente')",
                  (second[0], foreign_project))
    identity = LiveIdentity(str(first[0]), first[1], first[2])
    assert _bind(db, identity, 'stale-new-thread') is None
    assert _bind(db, identity, 'foreign-live-thread', str(foreign_project)) is None
    assert _bind(db, identity, 'invalid-live-thread', 'not-a-uuid') is None
    assert _bind(db, identity, 'project-live-thread', str(own_project)) is not None
    assert _bind(db, identity, 'project-live-thread', None) is None
    # Old clients opening an existing thread do not move it between projects.
    assert _bind(db, identity, 'project-live-thread') is not None
    assert _bind(db, identity, 'plain-live-thread', None) is not None
    with db.connect() as c:
        rows = c.execute('''SELECT id,project_id FROM uony_threads WHERE user_id=%s
            AND id IN ('stale-new-thread','foreign-live-thread','invalid-live-thread',
                       'project-live-thread','plain-live-thread')''', (first[0],)).fetchall()
    assert {row['id']: row['project_id'] for row in rows} == {
        'project-live-thread': own_project, 'plain-live-thread': None}
    with db.connect() as c:
        c.execute('UPDATE uony_projects SET deleted_at=now() WHERE user_id=%s AND id=%s',
                  (first[0], own_project))
    assert _bind(db, identity, 'project-live-thread', str(own_project)) is None
    assert _bind(db, identity, 'project-live-thread') is None


def test_live_socket_project_bind_and_fresh_context_exclude_old_assignments(environment):
    config, provider, db = environment
    first, second = account_setup(config, provider, db)
    own_project, foreign_project = uuid4(), uuid4()
    with db.connect() as c:
        c.execute("INSERT INTO uony_projects(user_id,id,name) VALUES(%s,%s,'1er producto')",
                  (first[0], own_project))
        c.execute("INSERT INTO uony_projects(user_id,id,name) VALUES(%s,%s,'Ajeno')",
                  (second[0], foreign_project))
        c.execute('''INSERT INTO uony_assignments
            (user_id,id,google_subject,origin_request_id,origin_thread_id,label,objective)
            VALUES(%s,%s,%s,%s,%s,%s,%s)''',
            (first[0], uuid4(), first[1], uuid4(), 'old-thread',
             'Producto antiguo', 'Preparar un producto antiguo'))
    enabled = replace(config, live_pilot_user_ids=(str(first[0]),))
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=config.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, first[3])) as ws:
            ws.send_json({'type': 'bind', 'threadId': 'stale-project-thread'})
            with pytest.raises(WebSocketDisconnect) as denied:
                ws.receive_json()
            assert denied.value.code == 1008
        assert fake.opened == []
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, first[3])) as ws:
            ws.send_json({'type': 'bind', 'threadId': 'foreign-project-thread',
                          'projectId': str(foreign_project)})
            with pytest.raises(WebSocketDisconnect) as denied:
                ws.receive_json()
            assert denied.value.code == 1008
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(config, first[3])) as ws:
            ws.send_json({'type': 'bind', 'threadId': 'drive-question-thread',
                          'projectId': str(own_project)})
            bound = ws.receive_json()
            assert bound['type'] == 'bound'
            ws.send_json({'type': 'ready', 'sessionId': bound['sessionId']})
            assert ws.receive_json()['state'] == 'ready'
            assert fake.opened[-1].context == ''
            history = client.get('/api/uony/threads', headers=headers(config, first[3]))
            thread = next(row for row in history.json()['threads']
                          if row['id'] == 'drive-question-thread')
            assert thread['projectId'] == str(own_project)
    assert len(fake.opened) == 1
