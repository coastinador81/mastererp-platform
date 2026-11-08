"""WebSocket route for the account-gated Live voice bridge."""
import asyncio
from contextlib import suppress
import json
import logging
import time
from uuid import UUID, uuid4

from fastapi import APIRouter, WebSocket
from . import uony_live_bridge as core
from .uony_live_router import LiveTurnRouter
from .uony_session_continuity import SessionContinuity
from .uony_session_transport import SessionOutputGuard, HEARTBEAT_INTERVAL_SECONDS
from .uony_live_handoff import INTENTS, route_final_turn
from .uony_live_delivery import LiveDeliveryTracker, LockedLiveSender
from .uony_live_audio_gate import LiveActionAudioGate, flush_ordinary_reply
from .uony_live_caption_receipts import (record_caption_started,
    finalize_caption_state, record_caption_usage)
from .uony_live_drive_context import metadata_turn_allowed, contextual_intent
from .uony_live_caption_session import LiveCaptionSession, LiveCaptionStatus, LiveCaptionUsage
from .security import SESSION_COOKIE, digest
from .uony_live_bridge import (
    MAX_AUDIO_BYTES, MAX_BIND_CHARS, MAX_CONTROL_CHARS, MAX_FRAME_BYTES,
    MAX_OUTPUT_BYTES, LiveAudio, LiveInterrupted, LiveProvider, LiveSpeechStarted,
    LiveSpeechEnded, LiveStatus, LiveToolCall, LiveTranscript,
    LiveTranscriptPreview, LiveUnconfirmedTurn, LiveUsage, _abandon_before_provider,
    _current_work, _identity, _record_usage, _release, _reserve,
    _save_transcript,
)

logger = logging.getLogger(__name__)
SESSION_DEADLINE_CODE = 4000
def _close_code(value):
    return value if type(value) is int and 1000 <= value <= 4999 else 'none'
def _task_failure(task):
    if task.cancelled():
        return 'CancelledError'
    error = task.exception()
    return type(error).__name__ if error is not None else 'none'
def routes(settings, database, live: LiveProvider | None = None):
    router = APIRouter(prefix='/api/uony')
    continuity = SessionContinuity(database)
    @router.websocket('/live')
    async def bridge(websocket: WebSocket):
        identity = _identity(settings, database, websocket, live)
        if identity is None:
            await websocket.close(code=1008)
            return
        session_hash = digest(websocket.cookies[SESSION_COOKIE])
        accepted = False
        disconnected = False
        output_task = None
        session = None
        output_bytes = received_bytes = 0
        tool_calls = consecutive_tool_calls = 0
        interruptions_sent = 0
        session_id = None
        reserved = False
        provider_attempted = False
        caption_attempted = False
        watchdog_task = None
        ready_sent = False
        handoff_timeout_task = None
        end_reason = 'none'
        failure_class = 'none'
        browser_close_code = 'none'
        bridge_close_code = 'none'
        delivery = None
        turn_router = None
        lease = recovered = guard = None
        sender = LockedLiveSender(websocket)
        audio_gate = LiveActionAudioGate(hold_until_final=True)
        async def watchdog():
            try:
                while True:
                    await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
                    guard.check()
                    validated_at = time.monotonic()
                    if (identity.user_id not in settings.live_pilot_user_ids
                            or not await asyncio.to_thread(core._session_allowed,
                                database, identity, session_id, session_hash)
                            or not await asyncio.to_thread(continuity.is_current, lease)):
                        raise ValueError('Live session revoked')
                    await asyncio.to_thread(continuity.heartbeat, lease)
                    guard.confirm(validated_at)
            except BaseException:
                guard.stop()
                raise
        try:
            await websocket.accept()
            accepted = True
            # Bind the owner and thread before opening a billable Google session.
            first_message = await asyncio.wait_for(websocket.receive(), timeout=5)
            raw = first_message.get('text')
            if not isinstance(raw, str) or len(raw) > MAX_BIND_CHARS:
                await websocket.close(code=1008)
                return
            try:
                first = json.loads(raw)
            except ValueError:
                first = None
            bound = core.bind_payload(database, identity, first)
            if bound is None:
                await websocket.close(code=1008)
                return
            identity = bound
            session_id = str(uuid4())
            if not await asyncio.to_thread(_reserve, database, identity, session_id,
                    session_hash, settings.live_pilot_session_limit):
                await websocket.close(code=1013)
                return
            reserved = True
            lease = await asyncio.to_thread(continuity.acquire, identity.user_id,
                identity.thread_id, session_id, google_subject=identity.google_subject,
                google_project_id=identity.project_id)
            guard = SessionOutputGuard()
            sender.set_guard(guard.check)
            recovered = await asyncio.to_thread(continuity.restore, identity.user_id,
                identity.thread_id, google_subject=identity.google_subject,
                google_project_id=identity.project_id)
            watchdog_task = asyncio.create_task(watchdog())
            await websocket.send_json({'type': 'bound', 'threadId': identity.thread_id,
                                       'sessionId': session_id})
            # The browser may have stopped voice or switched threads while the
            # bind was in flight. Require an explicit acknowledgment from the
            # still-current client before attempting a potentially paid socket.
            ready_message = await asyncio.wait_for(websocket.receive(), timeout=5)
            if ready_message['type'] == 'websocket.disconnect':
                disconnected = True
                return
            ready_raw = ready_message.get('text')
            if not isinstance(ready_raw, str) or len(ready_raw) > MAX_BIND_CHARS:
                await websocket.close(code=1008)
                return
            try:
                ready = json.loads(ready_raw)
            except ValueError:
                ready = None
            if ready != {'type': 'ready', 'sessionId': session_id}:
                await websocket.close(code=1008)
                return
            if not core._session_allowed(database, identity, session_id, session_hash):
                await websocket.close(code=1008)
                return
            provider_attempted = True
            try:
                session = await live.open(identity)
            except Exception as error:
                # Never log exception text: upstream handshakes may include a
                # project path or credentials. The class alone is safe context.
                logger.warning('Live provider open failed: %s', type(error).__name__)
                await websocket.close(code=1011)
                return
            if isinstance(session, LiveCaptionSession):
                caption_attempted = True
                record_caption_started(database, identity, session_id)
            if not core._session_allowed(database, identity, session_id, session_hash):
                await websocket.close(code=1008)
                return
            guard.check()
            await websocket.send_json({'type': 'status', 'state': 'ready',
                                       'audioProtocol': 'scoped-v1',
                                       'inputFormat': 'pcm_s16le_16000',
                                       'outputFormat': 'pcm_s16le_24000'})
            ready_sent = True
            delivery = LiveDeliveryTracker(database, settings, identity, session_id,
                session_hash, session, sender.event,
                renderer=getattr(live, 'render_verified', None), send_audio=sender.audio,
                sender=sender, continuity=continuity, lease=lease)
            await delivery.restore(recovered)
            # La duración útil comienza al confirmar Live, no durante OAuth y setup.
            deadline = asyncio.get_running_loop().time() + core.SESSION_SECONDS
            from .uony_live_vertex import VertexLiveProvider
            from .uony_live_semantic import LiveSemanticInterpreter
            interpreter = (LiveSemanticInterpreter(live, database, settings, identity,
                session_id, session_hash) if isinstance(live, VertexLiveProvider)
                else getattr(live, 'semantic_interpreter', None))
            turn_router = LiveTurnRouter(database, settings, identity, session_id,
                session_hash, session, delivery, sender, audio_gate,
                continuity=continuity, lease=lease, interpreter=interpreter)
            output_task = asyncio.create_task(turn_router.run())
            while True:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    end_reason, bridge_close_code = 'deadline', SESSION_DEADLINE_CODE
                    await websocket.close(code=SESSION_DEADLINE_CODE)
                    break
                incoming = asyncio.create_task(websocket.receive())
                done, _ = await asyncio.wait((incoming, output_task, watchdog_task), timeout=remaining,
                                             return_when=asyncio.FIRST_COMPLETED)
                if watchdog_task in done:
                    end_reason = 'watchdog'
                    failure_class = _task_failure(watchdog_task)
                    bridge_close_code = 1008 if failure_class != 'none' else 1000
                    incoming.cancel()
                    with suppress(asyncio.CancelledError):
                        await incoming
                    await websocket.close(code=bridge_close_code)
                    break
                if incoming not in done:
                    incoming.cancel()
                    with suppress(asyncio.CancelledError):
                        await incoming
                    if not done:
                        end_reason, bridge_close_code = 'deadline', SESSION_DEADLINE_CODE
                        await websocket.close(code=SESSION_DEADLINE_CODE)
                    else:
                        ended = output_task if output_task in done else watchdog_task
                        end_reason = 'provider_stream' if ended is output_task else 'watchdog'
                        failure_class = _task_failure(ended)
                        bridge_close_code = 1011 if failure_class != 'none' else 1000
                        await websocket.close(code=bridge_close_code)
                    break
                message = incoming.result()
                guard.check()
                if message['type'] == 'websocket.disconnect':
                    disconnected = True
                    end_reason = 'browser_disconnect'
                    browser_close_code = _close_code(message.get('code'))
                    break
                pcm = message.get('bytes')
                if pcm is not None:
                    if not pcm or len(pcm) > MAX_FRAME_BYTES or len(pcm) % 2:
                        end_reason, bridge_close_code = 'invalid_audio', 1009
                        await websocket.close(code=1009)
                        break
                    received_bytes += len(pcm)
                    if received_bytes > MAX_AUDIO_BYTES:
                        end_reason, bridge_close_code = 'audio_limit', 1009
                        await websocket.close(code=1009)
                        break
                    await session.send_audio(pcm)
                    continue
                control = message.get('text')
                if control is None or len(control) > MAX_CONTROL_CHARS:
                    end_reason, bridge_close_code = 'invalid_control', 1008
                    await websocket.close(code=1008)
                    break
                try:
                    command = json.loads(control)
                except (TypeError, ValueError):
                    command = None
                if (isinstance(command, dict) and set(command) == {'type', 'state'}
                        and command['type'] == 'playback_state'
                        and command['state'] in ('playing', 'idle')):
                    delivery.speech.client_playback(command['state'])
                    continue
                if (isinstance(command, dict)
                        and set(command) == {'type', 'generationId', 'outcome'}
                        and command['type'] == 'ordinary_ack'
                        and isinstance(command['generationId'], str)
                        and command['outcome'] in ('played', 'interrupted')):
                    turn_router.ordinary.acknowledge(command['generationId'], command['outcome'])
                    continue
                if (isinstance(command, dict)
                        and set(command) == {'type', 'eventId', 'outcome'}
                        and command['type'] == 'speech_ack'
                        and isinstance(command['eventId'], str)
                        and command['outcome'] in ('played', 'interrupted')):
                    await delivery.acknowledge(command['eventId'], command['outcome'])
                    continue
                if command != {'type': 'interrupt'}:
                    end_reason, bridge_close_code = 'invalid_control', 1008
                    await websocket.close(code=1008)
                    break
                end_reason = 'manual_stop'
                await session.interrupt()
        except asyncio.CancelledError:
            end_reason, failure_class, bridge_close_code = 'bridge_cancelled', 'CancelledError', 1011
            logger.warning('Live bridge cancelled before ready=%s', session is None)
            if accepted and not disconnected:
                with suppress(Exception):
                    await websocket.close(code=1011)
            raise
        except Exception as error:
            end_reason, failure_class, bridge_close_code = 'bridge_exception', type(error).__name__, 1011
            logger.warning('Live bridge failed before ready=%s: %s',
                           session is None, type(error).__name__)
            if accepted and not disconnected:
                with suppress(Exception):
                    await websocket.close(code=1011)
        finally:
            if guard is not None:
                guard.stop()
            if turn_router is not None:
                output_bytes = turn_router.output_bytes
                tool_calls = turn_router.tool_calls
                interruptions_sent = turn_router.interruptions_sent
                handoff_timeout_task = turn_router.handoff_timeout_task
            if delivery is not None:
                await delivery.close()
            if handoff_timeout_task is not None:
                handoff_timeout_task.cancel()
                with suppress(asyncio.CancelledError):
                    await handoff_timeout_task
            if ready_sent:
                upstream = getattr(session, 'websocket', None)
                upstream_close_code = _close_code(getattr(upstream, 'close_code', None))
                # Deliberately no transcript, audio, account, project, URL,
                # provider reason text, or exception message in diagnostics.
                logger.warning('Live post-ready ended reason=%s class=%s '
                    'browser_ws_code=%s bridge_ws_code=%s upstream_ws_code=%s '
                    'input_bytes=%d output_bytes=%d interruptions_sent=%d '
                    'drive_audio_gate_before_first_pcm=%d after_first_pcm=%d dropped_over_limit=%d',
                    end_reason, failure_class,
                    browser_close_code, bridge_close_code, upstream_close_code,
                    received_bytes, output_bytes, interruptions_sent,
                    audio_gate.armed_before_first_pcm, audio_gate.armed_after_first_pcm,
                    audio_gate.dropped_over_limit)
            if output_task is not None:
                output_task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await output_task
            if watchdog_task is not None:
                watchdog_task.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await watchdog_task
            if session is not None:
                with suppress(Exception):
                    await asyncio.wait_for(session.close(), timeout=2)
            if caption_attempted and reserved and session_id is not None:
                with suppress(Exception):
                    finalize_caption_state(database, identity, session_id)
            if lease is not None:
                # ASGI may cancel while finishing a disconnected socket. Do
                # not let that skip the existing synchronous slot release.
                with suppress(asyncio.CancelledError, Exception):
                    await asyncio.shield(asyncio.to_thread(continuity.close, lease))
            if reserved and session_id is not None:
                with suppress(Exception):
                    if provider_attempted:
                        _release(database, identity, session_id)
                    else:
                        _abandon_before_provider(database, identity, session_id)

    return router
