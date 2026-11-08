"""Voice-to-coordinator contract using fake sockets and an isolated database."""
from dataclasses import replace
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import create_app
from app.security import digest
from app.uony_assignment_tool import AssignmentTools
from app.uony_live_handoff import (MAX_HANDOFFS_PER_SESSION, _spoken_quote,
                                   route_final_turn)
from app.uony_live_bridge import (LiveAudio, LiveSpeechStarted, LiveStatus, LiveToolCall,
                                  LiveTranscript, _current_work)
from test_uony_live_bridge import FakeLive, account_setup, bind, headers


def prepared(environment):
    settings, provider, database = environment
    account = account_setup(settings, provider, database)[0]
    enabled = replace(settings, live_pilot_user_ids=(str(account[0]),),
                      adk_pilot_user_ids=(str(account[0]),))
    with database.connect() as c:
        c.execute('''INSERT INTO uony_model_checks
            (user_id,project_id,google_subject,model,effort)
            VALUES(%s,%s,%s,'gemini-3.5-flash','medium')''',
            (account[0], account[2], account[1]))
    return enabled, provider, database, account


def tool(session, spoken_text, call_id='handoff-call', intent='create_product'):
    session.emit(LiveToolCall(call_id, 'route_spoken_request',
        {'intent': intent, 'spokenText': spoken_text}))


def test_quote_keeps_meaningful_punctuation_and_tolerates_terminal_period():
    assert _spoken_quote('No quiero crear un producto.') != _spoken_quote(
        'No, quiero crear un producto.')
    assert _spoken_quote('QUIERO   crear un producto.') == _spoken_quote(
        'quiero crear un producto')
    assert _spoken_quote('¿Puedes crear un producto?') != _spoken_quote(
        'Puedes crear un producto.')


def test_negative_caption_and_ambiguous_quote_never_enqueue(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'negative-caption')
            negative = 'No quiero crear un producto en Amazon.'
            first_turn = str(uuid4())
            fake.sessions[0].emit(LiveTranscript('user', first_turn, negative))
            assert ws.receive_json()['type'] == 'transcript'
            fake.sessions[0].tool_response_event.clear()
            tool(fake.sessions[0], 'No, quiero crear un producto en Amazon.',
                 call_id='misquoted')
            assert fake.sessions[0].tool_response_event.wait(2)
            assert fake.sessions[0].tool_responses[-1][2]['reason'] == 'turn_mismatch'
            fake.sessions[0].tool_response_event.clear()
            tool(fake.sessions[0], negative, call_id='wrong-intent')
            assert fake.sessions[0].tool_response_event.wait(2)
            assert fake.sessions[0].tool_responses[-1][2]['reason'] == 'intent_not_confirmed'
            with db.connect() as c:
                assert c.execute('''SELECT count(*) AS n FROM uony_live_handoffs
                    WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
            positive = 'No, quiero crear un producto en Amazon.'
            second_turn = str(uuid4())
            fake.sessions[0].emit(LiveTranscript('user', second_turn, positive))
            assert ws.receive_json()['type'] == 'transcript'
            tool(fake.sessions[0], positive[:-1], call_id='positive')
            accepted = ws.receive_json()
            assert accepted['type'] == 'handoff'
            assert accepted['turnId'] == second_turn
            assert accepted['status'] == 'queued'


def test_final_spoken_turn_queues_one_adk_job_without_product_or_drive_action(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bound = bind(ws, 'spoken-product')
            turn_id = str(uuid4())
            spoken = 'Quiero crear Basic Mini Bricks usando documentos de Drive.'
            fake.sessions[0].emit(LiveSpeechStarted(turn_id))
            assert ws.receive_json()['type'] == 'speech_started'
            fake.sessions[0].emit(LiveTranscript('user', turn_id, spoken))
            assert ws.receive_json()['type'] == 'transcript'
            tool(fake.sessions[0], spoken, intent='use_drive_materials')
            first = ws.receive_json()
            assert first == {'type': 'handoff', 'turnId': turn_id,
                'requestId': first['requestId'], 'threadId': 'spoken-product',
                'status': 'queued'}
            assert fake.sessions[0].tool_responses == []
            # Repeated provider function call cannot enqueue another job while
            # the first function response awaits the durable terminal result.
            tool(fake.sessions[0], spoken, call_id='handoff-call', intent='use_drive_materials')
            assert fake.sessions[0].tool_responses == []
            with db.connect() as c:
                job = c.execute('''SELECT engine,payload FROM uony_conversation_jobs
                    WHERE user_id=%s AND request_id=%s''',
                    (account[0], first['requestId'])).fetchone()
                assert job['engine'] == 'adk'
                assert job['payload']['text'] == spoken
                assert all(job['payload'][name] is None for name in (
                    'productAction', 'materialAction', 'formResponse'))
                assert c.execute('''SELECT count(*) AS n FROM uony_live_handoffs
                    WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 1
                assert c.execute('''SELECT count(*) AS n FROM products
                    WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
                assert c.execute('''SELECT count(*) AS n FROM product_material_jobs
                    WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
            receipt = client.get('/api/uony/requests/' + first['requestId'],
                                 headers=headers(settings, account[3])).json()
            assert receipt['sourceLiveTurnId'] == turn_id
            assert receipt['sourceLiveSessionId'] == bound['sessionId']
            recent = client.get('/api/uony/requests/recent',
                                headers=headers(settings, account[3])).json()['requests']
            assert recent[0]['sourceLiveTurnId'] == turn_id


def test_tool_before_final_waits_for_final(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'inverted-order')
            turn_id = str(uuid4())
            fake.sessions[0].emit(LiveSpeechStarted(turn_id))
            assert ws.receive_json()['type'] == 'speech_started'
            tool(fake.sessions[0], 'Crear mi producto.')
            assert fake.sessions[0].tool_responses == []
            with db.connect() as c:
                assert c.execute('''SELECT count(*) AS n FROM uony_conversation_jobs
                    WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0
            fake.sessions[0].emit(LiveTranscript('user', turn_id, 'Crear mi producto.'))
            assert ws.receive_json()['type'] == 'transcript'
            assert ws.receive_json()['type'] == 'handoff'
        with db.connect() as c:
            assert c.execute('''SELECT count(*) AS n FROM uony_conversation_jobs
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 1

def test_disconnect_before_final_does_not_queue_a_job(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'no-final')
            turn_id = str(uuid4())
            fake.sessions[0].emit(LiveSpeechStarted(turn_id))
            assert ws.receive_json()['type'] == 'speech_started'
            tool(fake.sessions[0], 'Todavía estoy hablando.')
            ws.close()
        with db.connect() as c:
            assert c.execute('''SELECT count(*) AS n FROM uony_conversation_jobs
                WHERE user_id=%s AND thread_id='no-final' ''',
                (account[0],)).fetchone()['n'] == 0


def test_handoff_history_has_one_user_bubble_and_worker_reply(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'one-bubble')
            turn_id = str(uuid4())
            spoken = 'Quiero crear un producto en Amazon.'
            fake.sessions[0].emit(LiveSpeechStarted(turn_id))
            assert ws.receive_json()['type'] == 'speech_started'
            fake.sessions[0].emit(LiveTranscript('user', turn_id, spoken))
            assert ws.receive_json()['type'] == 'transcript'
            tool(fake.sessions[0], spoken)
            request_id = ws.receive_json()['requestId']
            fake.sessions[0].emit(LiveTranscript('assistant', str(uuid4()),
                'Prepararé el siguiente paso en este chat.',
                reply_to_turn_id=turn_id))
            fake.sessions[0].emit(LiveStatus('listening'))
            assert ws.receive_json() == {'type': 'status', 'state': 'listening'}
        with db.connect() as c:
            c.execute('''UPDATE uony_requests SET status='success',reply=%s
                WHERE user_id=%s AND request_id=%s''',
                ('¿Tienes documentación o partes de cero?', account[0], request_id))
            c.execute('''UPDATE uony_conversation_jobs SET status='success',
                finished_at=now()
                WHERE user_id=%s AND request_id=%s''', (account[0], request_id))
        history = client.get('/api/uony/threads',
                             headers=headers(settings, account[3])).json()['threads'][0]['messages']
        assert [item['role'] for item in history] == ['user', 'assistant']
        assert history[0]['turnId'] == turn_id and history[0]['text'] == spoken
        assert history[1]['sourceLiveTurnId'] == turn_id
        assert history[1]['requestId'] == request_id


def test_second_spoken_turn_uses_focus_created_by_first_handoff(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bound = bind(ws, 'product-then-drive')
            first_turn = str(uuid4())
            first_text = 'Quiero crear un producto en Amazon.'
            fake.sessions[0].emit(LiveSpeechStarted(first_turn))
            assert ws.receive_json()['type'] == 'speech_started'
            fake.sessions[0].emit(LiveTranscript('user', first_turn, first_text))
            assert ws.receive_json()['type'] == 'transcript'
            tool(fake.sessions[0], first_text)
            first_request = ws.receive_json()['requestId']
            # Simulate the completed coordinator's allowed memory write.
            with db.connect() as c:
                user = c.execute('SELECT * FROM users WHERE id=%s',
                                 (account[0],)).fetchone()
                assignment = AssignmentTools(db, user, 'product-then-drive',
                                             first_request, first_text)
                assert assignment.prepare({'kind': 'amazon_product',
                    'label': 'Producto en Amazon', 'intentQuote': first_text,
                    'startingPoint': 'unknown'})['prepared']
                assignment.commit(c, user)
                c.execute('''UPDATE uony_requests SET status='success',reply=%s
                    WHERE user_id=%s AND request_id=%s''',
                    ('¿Tienes documentos o partes de cero?', account[0], first_request))
                c.execute('''UPDATE uony_conversation_jobs SET status='success',
                    finished_at=now() WHERE user_id=%s AND request_id=%s''',
                    (account[0], first_request))
            prior = _current_work(db, fake.opened[0], settings,
                                  bound['sessionId'], digest(account[3]))
            assert prior['latestHandoff']['status'] == 'success'
            assert prior['latestHandoff']['replyPreview'] == (
                '¿Tienes documentos o partes de cero?')
            # The provider may produce a final caption without a new VAD.
            second_turn = str(uuid4())
            fake.sessions[0].emit(LiveTranscript('user', second_turn,
                'Tengo una carpeta con documentos en Drive.'))
            assert ws.receive_json()['type'] == 'transcript'
            tool(fake.sessions[0], 'Tengo una carpeta con documentos en Drive.',
                 call_id='second', intent='use_drive_materials')
            second = ws.receive_json()
            assert second['type'] == 'handoff'
            assert second['turnId'] == second_turn
            assert second['requestId'] != first_request
            assert second['status'] == 'queued'
            fake.sessions[0].tool_response_event.clear()
            fake.sessions[0].emit(LiveToolCall('work', 'get_current_work', {}))
            assert fake.sessions[0].tool_response_event.wait(2)
            work = fake.sessions[0].tool_responses[-1][2]
            assert work['latestHandoff']['requestId'] == second['requestId']
            assert work['latestHandoff']['status'] == 'queued'
            assert work['assignments'][0]['label'] == 'Producto en Amazon'


def test_duplicate_call_cannot_attach_to_later_cancellation(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'late-duplicate')
            first_turn = str(uuid4())
            fake.sessions[0].emit(LiveTranscript('user', first_turn,
                'Quiero crear un producto en Amazon.'))
            assert ws.receive_json()['type'] == 'transcript'
            tool(fake.sessions[0], 'Quiero crear un producto en Amazon.')
            assert ws.receive_json()['type'] == 'handoff'
            fake.sessions[0].tool_response_event.clear()
            tool(fake.sessions[0], 'Quiero crear un producto en Amazon.',
                 call_id='late-duplicate')
            assert fake.sessions[0].tool_response_event.wait(2)
            assert fake.sessions[0].tool_responses[-1][2]['reason'] == 'already_routed'
            second_turn = str(uuid4())
            fake.sessions[0].emit(LiveSpeechStarted(second_turn))
            assert ws.receive_json()['type'] == 'speech_started'
            fake.sessions[0].emit(LiveTranscript('user', second_turn, 'No, detente.'))
            assert ws.receive_json()['type'] == 'transcript'
        with db.connect() as c:
            assert c.execute('''SELECT count(*) AS n FROM uony_live_handoffs
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 1


def test_late_call_from_a_after_b_starts_is_blocked(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'ambiguous-call')
            a, b = str(uuid4()), str(uuid4())
            fake.sessions[0].emit(LiveTranscript('user', a,
                'Voy a contarte mi producto de Amazon.'))
            assert ws.receive_json()['type'] == 'transcript'
            fake.sessions[0].emit(LiveSpeechStarted(b))
            assert ws.receive_json()['type'] == 'speech_started'
            fake.sessions[0].tool_response_event.clear()
            tool(fake.sessions[0], 'Voy a contarte mi producto de Amazon.', call_id='late-a')
            assert fake.sessions[0].tool_response_event.wait(2)
            assert fake.sessions[0].tool_responses[-1][2]['reason'] == 'ambiguous_turn'
            fake.sessions[0].emit(LiveTranscript('user', b, 'No, detente.'))
            assert ws.receive_json()['type'] == 'transcript'
        with db.connect() as c:
            assert c.execute('''SELECT count(*) AS n FROM uony_live_handoffs
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 0


def test_quote_prevents_late_a_call_from_using_final_b(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'quoted-turns')
            a, b = str(uuid4()), str(uuid4())
            a_text = 'Voy a contarte mi producto de Amazon.'
            b_text = 'Tengo documentos de Basic Mini Bricks en Drive.'
            fake.sessions[0].emit(LiveTranscript('user', a, a_text))
            assert ws.receive_json()['type'] == 'transcript'
            fake.sessions[0].emit(LiveTranscript('user', b, b_text))
            assert ws.receive_json()['type'] == 'transcript'
            fake.sessions[0].tool_response_event.clear()
            tool(fake.sessions[0], a_text, call_id='late-a')
            assert fake.sessions[0].tool_response_event.wait(2)
            assert fake.sessions[0].tool_responses[-1][2]['reason'] == 'turn_mismatch'
            tool(fake.sessions[0], b_text, call_id='actual-b',
                 intent='use_drive_materials')
            handoff = ws.receive_json()
            assert handoff['type'] == 'handoff' and handoff['turnId'] == b
        with db.connect() as c:
            assert c.execute('''SELECT count(*) AS n FROM uony_live_handoffs
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 1


def test_voice_handoff_refuses_running_synchronous_request(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'sync-busy')
            a, b = str(uuid4()), str(uuid4())
            first_text = 'Quiero crear un producto en Amazon.'
            fake.sessions[0].emit(LiveTranscript('user', a, first_text))
            assert ws.receive_json()['type'] == 'transcript'
            tool(fake.sessions[0], first_text)
            request_id = ws.receive_json()['requestId']
            with db.connect() as c:
                c.execute('''DELETE FROM uony_conversation_jobs
                    WHERE user_id=%s AND request_id=%s''', (account[0], request_id))
                c.execute('''UPDATE uony_requests SET status='running'
                    WHERE user_id=%s AND request_id=%s''', (account[0], request_id))
            second_text = 'Tengo materiales en Drive.'
            fake.sessions[0].emit(LiveTranscript('user', b, second_text))
            assert ws.receive_json()['type'] == 'transcript'
            fake.sessions[0].tool_response_event.clear()
            tool(fake.sessions[0], second_text, call_id='busy-b',
                 intent='use_drive_materials')
            assert fake.sessions[0].tool_response_event.wait(2)
            assert fake.sessions[0].tool_responses[-1][2]['reason'] == 'busy'
        with db.connect() as c:
            assert c.execute('''SELECT count(*) AS n FROM uony_live_handoffs
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 1


def test_session_handoff_cap_blocks_ninth_without_new_job(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bound = bind(ws, 'bounded-voice')
            assert MAX_HANDOFFS_PER_SESSION == 8
            for index in range(MAX_HANDOFFS_PER_SESSION + 1):
                turn_id = str(uuid4())
                spoken = f'Quiero preparar el producto número {index} en Amazon.'
                fake.sessions[0].emit(LiveTranscript('user', turn_id, spoken))
                assert ws.receive_json()['type'] == 'transcript'
                result = route_final_turn(db, settings, fake.opened[0],
                    bound['sessionId'], digest(account[3]), turn_id,
                    'create_product', spoken)
                if index == MAX_HANDOFFS_PER_SESSION:
                    assert result == {'status': 'blocked',
                                      'reason': 'session_handoff_limit'}
                    break
                assert result['status'] == 'queued'
                with db.connect() as c:
                    c.execute('''UPDATE uony_requests SET status='success',reply='Listo.'
                        WHERE user_id=%s AND request_id=%s''',
                        (account[0], result['requestId']))
                    c.execute('''UPDATE uony_conversation_jobs SET status='success',
                        finished_at=now() WHERE user_id=%s AND request_id=%s''',
                        (account[0], result['requestId']))
        with db.connect() as c:
            assert c.execute('''SELECT count(*) AS n FROM uony_live_handoffs
                WHERE user_id=%s''', (account[0],)).fetchone()['n'] == 8


def test_tool_call_cap_returns_blocked_without_closing_voice(environment):
    settings, provider, db, account = prepared(environment)
    fake = FakeLive()
    with TestClient(create_app(settings, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                headers=headers(settings, account[3])) as ws:
            bind(ws, 'tool-cap')
            for index in range(17):
                fake.sessions[0].tool_response_event.clear()
                fake.sessions[0].emit(LiveToolCall(
                    f'status-{index}', 'get_current_work', {}))
                assert fake.sessions[0].tool_response_event.wait(2)
            assert fake.sessions[0].tool_responses[-1][2] == {
                'status': 'blocked', 'reason': 'tool_call_limit'}
            next_turn = str(uuid4())
            fake.sessions[0].emit(LiveTranscript('user', next_turn,
                'Seguimos hablando.'))
            assert ws.receive_json()['turnId'] == next_turn

