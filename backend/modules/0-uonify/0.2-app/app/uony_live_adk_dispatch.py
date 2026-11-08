"""Server side of ADK Live tools (ADK-FLUJOS §3, §10.2 and §10.3).

For each model-issued call: link it to the user turn the provider was
answering (captured from the original packets), wait for that turn's primary
final without holding audio or locks, and admit the turn or recover its single
receipt. The call is answered at once with the status and request id only:
the conversational model never receives the result or any Drive content
(audit F0.3); the durable delivery shows it in the chat and narrates it. A
Drive request is typed: the server resolves the folder or file and emits the
scope with the admission (uony_drive_scope, audit F0.1/F0.2).
"""
import asyncio
import logging
import time

from .uony_drive_scope import (DRIVE_NOTICE_FALLBACK, DRIVE_NOTICES, named_in,
                               resolve_for_identity, typed_request)
from .uony_live_bridge import _current_work
from .uony_live_provenance import PRIMARY_ACTION_SOURCES, PRIMARY_METADATA_SOURCES
from .uony_refusal import refused

# Drive goes only through the typed route_drive_request (audit F0.2).
LIVE_INTENTS = frozenset({'create_product', 'creative_plan'})
PRIMARY_SOURCES = PRIMARY_ACTION_SOURCES | PRIMARY_METADATA_SOURCES
# Primary finalization may trail the call, as the raw route's 12 s handoff wait.
EVIDENCE_SECONDS = 12
POLL_SECONDS = .3
MAX_CALLS = 16
ACCEPTED = ('Encargo aceptado. El resultado aparecerá en el chat y Uony lo leerá en voz '
            'alta; no lo anticipes ni lo inventes.')
# Reading Drive content by voice stays off until the model passes the F1-8
# corpus (≥95 %, 0 reads out of scope) and «Consultor google» lifts it: the
# server answers with a fixed notice and the customer asks in writing.
VOICE_READ = False
logger = logging.getLogger(__name__)


def _log_block(name, reason):
    # Codes only (real voice, 20-10-2026: an unexplained rejection could not be
    # diagnosed afterwards); the customer's words never reach this log.
    code = (reason if isinstance(reason, str) and reason.isidentifier()
            and len(reason) <= 40 else 'other')
    logger.warning('Live ADK tool not admitted name=%s reason=%s', name, code)


def _blocked(name, reason):
    _log_block(name, reason)
    return {'status': 'blocked', 'reason': reason}


class AdkToolDispatcher:
    """Bound to one router and voice socket; never shared between accounts."""

    def __init__(self, router, session, admit, closed):
        self.router, self.session = router, session
        self.admit, self.closed = admit, closed
        self.calls = 0

    async def __call__(self, call_id, name, args):
        self.calls += 1
        if self.calls > MAX_CALLS:
            return _blocked(name, 'tool_call_limit')
        router = self.router
        if name == 'get_current_work':
            if args:
                return _blocked(name, 'invalid_live_tool')
            # Read-only status of existing work: never a new execution (T13).
            return await asyncio.to_thread(_current_work, router.database, router.identity,
                router.settings, router.session_id, router.session_hash)
        if name == 'route_drive_request':
            return await self._drive(call_id, args)
        if (name != 'route_spoken_request' or set(args) != {'intent', 'spokenText'}
                or args['intent'] not in LIVE_INTENTS
                or not isinstance(args['spokenText'], str)
                or not 1 <= len(args['spokenText']) <= 3000):
            return _blocked(name, 'invalid_live_tool')
        turn_id = self.session.turn_for_call(call_id)
        if not turn_id:
            return _blocked(name, 'ambiguous_turn')
        text = await self._primary_text(turn_id)
        if text is None:
            # Owner decision 20-10-2026: say so and ask to repeat (once per turn).
            await router.delivery.unconfirmed(turn_id, args['spokenText'],
                                              intent='semantic_request')
            return _blocked(name, 'final_transcript_required')
        if self.closed(turn_id):
            return _blocked(name, 'repeat_requested')
        # spokenText is what the model says it heard: diagnostic only. The
        # admitted words are the persisted primary final (audit F0, 1b).
        outcome = await self.admit(turn_id, args['intent'], text)
        if isinstance(outcome, dict) and outcome.get('reason') == 'intent_not_confirmed':
            return await self._notice(name, turn_id, 'intent_not_confirmed')
        return self._answer(name, outcome)

    async def _drive(self, call_id, args):
        name = 'route_drive_request'
        try:
            operation, kind, target_name = typed_request(args, spoken=True)
        except ValueError:
            return _blocked(name, 'invalid_drive_request')
        # Diagnostic only: what the model says it heard never decides (audit F0, 1b).
        logger.warning('Live drive request operation=%s kind=%s heard_chars=%d',
                       operation, kind, len(args['spokenText']))
        turn_id = self.session.turn_for_call(call_id)
        if not turn_id:
            return _blocked(name, 'ambiguous_turn')
        router = self.router
        if operation == 'read' and not VOICE_READ:
            return await self._notice(name, turn_id, 'read_requires_text')
        text = await self._primary_text(turn_id)
        if text is None:
            await router.delivery.unconfirmed(turn_id, args['spokenText'],
                                              intent='semantic_request')
            return _blocked(name, 'final_transcript_required')
        if self.closed(turn_id):
            return _blocked(name, 'repeat_requested')
        if refused(text):
            # «No lo abras»: a refusal is never an order, nor a reason to call Drive.
            return await self._notice(name, turn_id, 'intent_not_confirmed')
        target = None
        if kind != 'account':
            # The resource must be named in the customer's own final words, so
            # an invented or suggested targetName never reaches Drive (A1).
            error = None if named_in(target_name, text) else 'target_not_in_order'
            if error is None:
                target = await asyncio.to_thread(resolve_for_identity, router.database,
                    router.settings, router.identity, kind, target_name)
                error = target.get('error')
            if error:
                # Never guessed: the customer is asked, with a fixed notice.
                return await self._notice(name, turn_id, error)
        # The persisted primary transcript is the evidence, not the model's quote.
        return self._answer(name, await self.admit(turn_id, 'drive_request', text,
            {'operation': operation, 'kind': kind, 'target': target}))

    async def _notice(self, name, turn_id, reason):
        """The server tells the customer with a fixed text, never the model
        («Consultor google» F0, Q2 and veto condition c); `notice` lets the
        model know it must not repeat or extend it."""
        await self.router.delivery.speech.say_notice(
            turn_id, DRIVE_NOTICES.get(reason, DRIVE_NOTICE_FALLBACK))
        _log_block(name, reason)
        return {'status': 'blocked', 'reason': reason, 'notice': 'server'}

    def _answer(self, name, outcome):
        if not isinstance(outcome, dict):
            return _blocked(name, 'admission_unavailable')
        if not outcome.get('requestId'):
            _log_block(name, outcome.get('reason'))
            return {'status': 'blocked', 'reason': outcome.get('reason')}
        logger.warning('Live ADK tool admitted replayed=%s', bool(outcome.get('replayed')))
        return {'status': outcome['status'], 'requestId': outcome['requestId'],
                'message': ACCEPTED}

    async def _primary_text(self, turn_id):
        """The turn's persisted primary final text, waited for a bounded time."""
        deadline = time.monotonic() + EVIDENCE_SECONDS
        while True:
            row = await asyncio.to_thread(self._source, turn_id)
            if row and row['finalized_by'] in PRIMARY_SOURCES:
                return row['text']
            if time.monotonic() >= deadline or self.closed(turn_id):
                return None
            await asyncio.sleep(POLL_SECONDS)

    def _source(self, turn_id):
        router = self.router
        with router.database.connect() as connection:
            return connection.execute('''SELECT finalized_by,text FROM uony_live_turns
                WHERE user_id=%s AND thread_id=%s AND session_id=%s
                  AND turn_id=%s AND role='user' ''',
                (router.identity.user_id, router.identity.thread_id,
                 router.session_id, turn_id)).fetchone()
