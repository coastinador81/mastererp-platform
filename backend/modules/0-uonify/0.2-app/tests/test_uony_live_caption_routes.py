"""Caption events share the existing pilot socket without creating work."""
from dataclasses import replace
from uuid import uuid4
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import digest
from app.uony_live_bridge import (LiveIdentity, LiveUsage, _bind, _record_usage,
                                  _release, _reserve)
from app.uony_live_caption_session import LiveCaptionSession, LiveCaptionStatus, LiveCaptionUsage
from app.uony_live_caption_receipts import (
    finalize_caption_state as _finalize_caption_state,
    record_caption_started as _record_caption_started,
    record_caption_usage as _record_caption_usage,
)
from test_uony_live_bridge import FakeLive, account_setup, bind, headers, work_counts


def test_caption_status_and_usage_remain_separate_from_primary(environment):
    settings, provider, database = environment
    account = account_setup(settings, provider, database)[0]
    enabled = replace(settings, live_pilot_user_ids=(str(account[0]),))
    fake = FakeLive()
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(settings, account[3])) as websocket:
            bound = bind(websocket, 'caption-usage-thread')
            session = fake.sessions[0]
            session.emit(LiveCaptionStatus('ready'))
            assert websocket.receive_json() == {'type': 'caption_status', 'state': 'ready'}
            session.emit(LiveCaptionUsage({'promptTokenCount': 7}))
            session.emit(LiveUsage({'promptTokenCount': 13}))
            session.emit(LiveCaptionStatus('unavailable'))
            assert websocket.receive_json() == {'type': 'caption_status',
                                                'state': 'unavailable'}
            with database.connect() as connection:
                receipt = connection.execute('''SELECT usage FROM uony_live_usage
                    WHERE user_id=%s AND session_id=%s''',
                    (account[0], bound['sessionId'])).fetchone()
            assert receipt['usage'] == {'promptTokenCount': 13,
                                        'transcribe': {'promptTokenCount': 7},
                                        'transcribeState': 'observed'}
    assert work_counts(database) == (0, 0, 0)


def test_caption_attempt_without_usage_is_unknown_even_when_primary_usage_is_observed(environment):
    settings, provider, database = environment
    account = account_setup(settings, provider, database)[0]
    identity = _bind(database, LiveIdentity(str(account[0]), account[1], account[2]),
                     'caption-unknown-thread', None)
    assert identity is not None
    session_id = str(uuid4())
    assert _reserve(database, identity, session_id, digest(account[3]))
    _record_caption_started(database, identity, session_id)
    _record_usage(database, identity, session_id, LiveUsage({'promptTokenCount': 13}))
    _finalize_caption_state(database, identity, session_id)
    with database.connect() as connection:
        row = connection.execute('''SELECT state,usage FROM uony_live_usage
            WHERE user_id=%s AND session_id=%s''', (account[0], session_id)).fetchone()
    assert row == {'state': 'observed', 'usage': {'promptTokenCount': 13,
                                                 'transcribeState': 'unknown'}}
    _release(database, identity, session_id)


def test_caption_usage_does_not_make_primary_usage_look_observed(environment):
    settings, provider, database = environment
    account = account_setup(settings, provider, database)[0]
    identity = _bind(database, LiveIdentity(str(account[0]), account[1], account[2]),
                     'caption-observed-thread', None)
    assert identity is not None
    session_id = str(uuid4())
    assert _reserve(database, identity, session_id, digest(account[3]))
    _record_caption_started(database, identity, session_id)
    _record_caption_usage(database, identity, session_id,
                          LiveCaptionUsage({'promptTokenCount': 7}))
    _finalize_caption_state(database, identity, session_id)
    _release(database, identity, session_id)
    with database.connect() as connection:
        row = connection.execute('''SELECT state,usage FROM uony_live_usage
            WHERE user_id=%s AND session_id=%s''', (account[0], session_id)).fetchone()
    assert row == {'state': 'unknown', 'usage': {
        'transcribe': {'promptTokenCount': 7}, 'transcribeState': 'observed'}}


def test_caption_setup_failure_records_unknown_without_usage_metadata(environment):
    settings, provider, database = environment
    account = account_setup(settings, provider, database)[0]
    enabled = replace(settings, live_pilot_user_ids=(str(account[0]),))

    class FakeCaptionedLive(FakeLive):
        async def open(self, identity):
            primary = await super().open(identity)
            return LiveCaptionSession(primary, None)

    fake = FakeCaptionedLive()
    with TestClient(create_app(enabled, provider=provider, live=fake),
                    base_url=settings.origin) as client:
        with client.websocket_connect('/api/uony/live',
                                      headers=headers(settings, account[3])) as websocket:
            bound = bind(websocket, 'caption-no-usage-thread')
            assert websocket.receive_json() == {'type': 'caption_status', 'state': 'unavailable'}
            with database.connect() as connection:
                row = connection.execute('''SELECT usage FROM uony_live_usage
                    WHERE user_id=%s AND session_id=%s''',
                    (account[0], bound['sessionId'])).fetchone()
            assert row['usage'] == {'transcribeState': 'unknown'}
    assert fake.sessions[0].closed
    assert work_counts(database) == (0, 0, 0)
