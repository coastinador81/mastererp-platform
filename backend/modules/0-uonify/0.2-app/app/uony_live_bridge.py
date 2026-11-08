"""Account-gated Live voice bound to a durable Uony conversation.

Wire contract for the injected pilot provider: binary client frames are raw mono
16 kHz signed 16-bit PCM; binary server frames are raw mono 24 kHz signed 16-bit
PCM. JSON is reserved for the typed status and interruption events below.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import re
from uuid import UUID, uuid4
from psycopg.types.json import Jsonb
from typing import AsyncIterator, Protocol

from fastapi import HTTPException, WebSocket

from .access import workspace_access
from .google_cloud_provider import SCOPE
from .onboarding import require_user
from .uony_session_transport import RECLAIM_AFTER_SECONDS


MAX_FRAME_BYTES = 8192
SESSION_SECONDS = 8 * 60
SESSION_HANDSHAKE_MARGIN_SECONDS = 120
MAX_AUDIO_BYTES = SESSION_SECONDS * 16_000 * 2  # Mono PCM16 de entrada.
MAX_OUTPUT_BYTES = SESSION_SECONDS * 24_000 * 2  # Mono PCM16 de salida.
MAX_CONTROL_CHARS = 128
MAX_BIND_CHARS = 224
MAX_ACTIVE_SESSIONS = 64
THREAD_ID = re.compile(r'^[A-Za-z0-9_-]{1,80}$')
PROJECT_UNSPECIFIED = object()


@dataclass(frozen=True)
class LiveIdentity:
    user_id: str
    google_subject: str
    project_id: str
    thread_id: str = ''
    context: str = ''
    focus_assignment_id: str | None = None
    focus_version: int = 0


@dataclass(frozen=True)
class LiveAudio:
    pcm: bytes
    generation_id: str | None = field(default=None, compare=False)
    reply_to_turn_id: str | None = field(default=None, compare=False)


@dataclass(frozen=True)
class LiveStatus:
    state: str
    generation_id: str | None = field(default=None, compare=False)


@dataclass(frozen=True)
class LiveInterrupted:
    pass


@dataclass(frozen=True)
class LiveSpeechStarted:
    """Gemini detected the customer's voice; flush pending playback only."""
    turn_id: str = field(default='', compare=False)


@dataclass(frozen=True)
class LiveSpeechEnded:
    """Speech boundary; may be inferred from voiced PCM before a model reply."""
    turn_id: str


@dataclass(frozen=True)
class LiveTranscript:
    role: str
    turn_id: str
    text: str
    occurred_at: datetime | None = field(default=None, compare=False)
    reply_to_turn_id: str | None = field(default=None, compare=False)
    # Only provider_finished can authorize a deterministic voice fallback.
    # A reply boundary can flush provisional text for UI but may omit a later
    # qualification such as "pero no todavía".
    finalized_by: str = field(default='', compare=False)


@dataclass(frozen=True)
class LiveTranscriptPreview:
    """Uncommitted text for display only; an empty text withdraws it."""
    role: str
    turn_id: str
    text: str
    reply_to_turn_id: str | None = field(default=None, compare=False)


@dataclass(frozen=True)
class LiveUnconfirmedTurn:
    """Provider ended a turn while its spoken words remained provisional."""
    turn_id: str
    text: str


@dataclass(frozen=True)
class LiveToolCall:
    call_id: str
    name: str
    args: dict


@dataclass(frozen=True)
class LiveUsage:
    counts: dict


@dataclass(frozen=True)
class LiveSubtitle:
    """PIEZA 2 — subtítulo de SOLO presentación del gateway (nunca se persiste): se reenvía al
    navegador y no autoriza ninguna acción. Proyección mínima: role 'user'|'uony', text (texto
    completo acumulado hasta ahora) y finished. Distinto de LiveTranscript, que es la ruta
    ADK/caption persistida (role/turn_id/occurred_at/reply_to_turn_id/finalized_by)."""
    role: str
    text: str
    finished: bool


@dataclass(frozen=True)
class LiveUserFinal:
    """PIEZA 3 paso 2 — señal de FINAL del turno del USUARIO para AUTORIZAR acciones agénticas del
    gateway (feed al MISMO gate). DISTINTA de LivePersistTurn: persist≠autoriza (LivePersistTurn nunca
    alimenta el gate). Solo del usuario; assistant nunca la emite. Mismo turn_id que su LivePersistTurn."""
    turn_id: str
    finalized_by: str = ''


class LiveSession(Protocol):
    async def send_audio(self, pcm: bytes) -> None: ...
    async def interrupt(self) -> None: ...
    async def respond_tool(self, call_id: str, name: str, response: dict,
                           scheduling: str | None = None) -> None: ...
    async def send_system_context(self, text: str) -> None: ...
    def events(self) -> AsyncIterator[LiveAudio | LiveStatus | LiveInterrupted | LiveSpeechStarted | LiveSpeechEnded | LiveTranscript | LiveTranscriptPreview | LiveUnconfirmedTurn | LiveToolCall | LiveUsage | LiveSubtitle | LiveUserFinal]: ...
    async def close(self) -> None: ...


class LiveProvider(Protocol):
    async def open(self, identity: LiveIdentity) -> LiveSession: ...


async def forward_subtitle(sender, event: LiveSubtitle) -> None:
    """PIEZA 2 — reenvía un subtítulo de SOLO presentación al navegador: proyección mínima
    {role,text,finished}, nunca persiste ni autoriza nada (C1/C3/C5). Un subtítulo malformado se
    descarta en silencio; jamás lanza, para no cortar la voz (PIEZA 1 intacta)."""
    if (event.role in ('user', 'uony') and isinstance(event.text, str)
            and len(event.text) <= 3000 and isinstance(event.finished, bool)):
        await sender.event({'type': 'subtitle', 'role': event.role,
                            'text': event.text, 'finished': event.finished})


def pilot_budget_available(connection, user_id, session_limit: int | None) -> bool:
    """Display hint only; _reserve repeats this check under the admission lock."""
    if session_limit is None:
        return True
    if type(session_limit) is not int or session_limit < 1:
        return False
    used = connection.execute('''SELECT count(*) AS n FROM uony_live_pilot_admissions
        WHERE user_id=%s''', (user_id,)).fetchone()['n']
    return used < session_limit


def _identity(settings, database, websocket: WebSocket, live: LiveProvider | None):
    # Browser cookies accompany WebSocket upgrades. Origin is a separate CSRF
    # boundary, because CORS middleware does not protect WebSocket handshakes.
    if (websocket.headers.getlist('origin') != [settings.origin] or websocket.query_params
            or websocket.headers.get('authorization') or live is None):
        return None
    with database.connect() as connection:
        try:
            user = require_user(connection, websocket)
        except HTTPException:
            return None
        if (str(user['id']) not in settings.live_pilot_user_ids
                or not user.get('onboarding_completed_at')
                or workspace_access(connection, user)['status'] != 'allowed'
                or not pilot_budget_available(connection, user['id'],
                                              settings.live_pilot_session_limit)):
            return None
        row = connection.execute('''SELECT google_subject,project_id,status,project_check,scope
            FROM google_cloud_connections WHERE user_id=%s''', (user['id'],)).fetchone()
        if (not row or row['google_subject'] != user['google_subject']
                or row['status'] != 'connected' or not row['project_id']
                or not (row['project_check'] or {}).get('ready')
                or SCOPE not in (row['scope'] or '').split()):
            return None
        return LiveIdentity(str(user['id']), user['google_subject'], row['project_id'])


def bind_payload(database, identity: LiveIdentity, payload):
    """Accept old binds for saved threads; new threads need an explicit project."""
    if (not isinstance(payload, dict) or payload.get('type') != 'bind' or
            set(payload) not in ({'type', 'threadId'},
                                 {'type', 'threadId', 'projectId'})):
        return None
    if 'projectId' in payload:
        return _bind(database, identity, payload['threadId'], payload['projectId'])
    return _bind(database, identity, payload['threadId'])


def _bind(database, identity: LiveIdentity, thread_id: str,
          workspace_project_id=PROJECT_UNSPECIFIED):
    if not isinstance(thread_id, str) or not THREAD_ID.fullmatch(thread_id):
        return None
    project_specified = workspace_project_id is not PROJECT_UNSPECIFIED
    if project_specified and workspace_project_id is not None:
        if not isinstance(workspace_project_id, str):
            return None
        try:
            if str(UUID(workspace_project_id)) != workspace_project_id:
                return None
        except ValueError:
            return None
    with database.connect() as connection:
        # The owner row fences account deletion and an old Google identity.
        user = connection.execute('''SELECT id,google_subject,deletion_requested_at FROM users
            WHERE id=%s FOR SHARE''', (identity.user_id,)).fetchone()
        if (not user or user['deletion_requested_at']
                or user['google_subject'] != identity.google_subject):
            return None
        row = connection.execute('''SELECT project_id,deleted_at FROM uony_threads
            WHERE user_id=%s AND id=%s FOR SHARE''', (identity.user_id, thread_id)).fetchone()
        if row and row['deleted_at']:
            return None
        saved_project = str(row['project_id']) if row and row['project_id'] else None
        if row and project_specified and saved_project != workspace_project_id:
            return None
        if not row and not project_specified:
            # An old browser bundle cannot tell us whether its new voice thread
            # belongs to a workspace project. Never silently create it outside
            # the customer's selected project.
            return None
        project = workspace_project_id if project_specified else saved_project
        if project and not connection.execute('''SELECT 1 FROM uony_projects
            WHERE user_id=%s AND id=%s AND deleted_at IS NULL FOR SHARE''',
            (identity.user_id, project)).fetchone():
            return None
        if not row:
            connection.execute('''INSERT INTO uony_threads(user_id,id,project_id,title)
                VALUES(%s,%s,%s,%s)''',
                (identity.user_id, thread_id, project, 'Conversación por voz'))
        rows = connection.execute('''SELECT role,text,created_at FROM uony_live_turns
            WHERE user_id=%s AND thread_id=%s ORDER BY created_at DESC LIMIT 12''',
            (identity.user_id, thread_id)).fetchall()
        classic = connection.execute('''SELECT r.prompt,r.reply,r.created_at,
                h.request_id IS NOT NULL AS from_live
            FROM uony_requests r LEFT JOIN uony_live_handoffs h
                ON h.user_id=r.user_id AND h.request_id=r.request_id
            WHERE r.user_id=%s AND r.thread_id=%s AND r.status='success'
            ORDER BY r.created_at DESC LIMIT 6''',
            (identity.user_id, thread_id)).fetchall()
        turns = [(row['created_at'], row['role'], row['text']) for row in rows]
        for row in classic:
            if not row['from_live']:
                turns.append((row['created_at'], 'user', row['prompt']))
            # A result may carry Drive content: Live learns only that it exists (F0.3).
            turns.append((row['created_at'], 'assistant', '[Uony respondió en el chat]'))
        turns.sort(key=lambda turn: turn[0])
        # Do not pass credentials, raw files, or an unlimited chat log to Live.
        history = '\n'.join(f'{role}: {text[:500]}' for _,role,text in turns[-12:])
        # Other threads' assignments remain available only through an explicit
        # get_current_work call; a fresh Drive question must not inherit them.
        from .uony_assignments import focus_snapshot
        focus_id, focus_version = focus_snapshot(connection, user, thread_id)
        return LiveIdentity(identity.user_id, identity.google_subject,
                            identity.project_id, thread_id, history[:6000],
                            str(focus_id) if focus_id else None, focus_version)


def _save_transcript(database, identity: LiveIdentity, session_id: str, event: LiveTranscript):
    from .uony_live_provenance import transcript_source, promote_transcript_source
    if (event.role not in ('user', 'assistant') or not isinstance(event.text, str)
            or not 1 <= len(event.text.strip()) <= 3000):
        raise ValueError('invalid Live transcript')
    try:
        turn_id = UUID(event.turn_id)
        reply_to_turn_id = (UUID(event.reply_to_turn_id)
                            if event.reply_to_turn_id is not None else None)
    except (TypeError, ValueError, AttributeError) as error:
        raise ValueError('invalid Live turn') from error
    if event.role != 'assistant' and reply_to_turn_id is not None:
        raise ValueError('invalid Live reply relation')
    occurred_at = event.occurred_at or datetime.now(timezone.utc)
    if not isinstance(occurred_at, datetime) or occurred_at.tzinfo is None:
        raise ValueError('invalid Live turn time')
    with database.connect() as connection:
        owner = connection.execute('''SELECT u.google_subject,u.deletion_requested_at,
            c.google_subject AS cloud_subject,c.project_id,c.status
            FROM users u LEFT JOIN google_cloud_connections c ON c.user_id=u.id
            WHERE u.id=%s''', (identity.user_id,)).fetchone()
        row = connection.execute('''SELECT deleted_at FROM uony_threads
            WHERE user_id=%s AND id=%s FOR SHARE''',
            (identity.user_id, identity.thread_id)).fetchone()
        if (not owner or owner['deletion_requested_at']
                or owner['google_subject'] != identity.google_subject
                or owner['cloud_subject'] != identity.google_subject
                or owner['project_id'] != identity.project_id
                or owner['status'] != 'connected' or not row or row['deleted_at']):
            raise ValueError('Live thread unavailable')
        if reply_to_turn_id is not None:
            # The server's durable answer is canonical for this exact turn.
            # Gemini can finish a provisional utterance after the handoff.
            handoff = connection.execute('''SELECT 1 FROM uony_live_handoffs
                WHERE user_id=%s AND thread_id=%s AND session_id=%s AND turn_id=%s''',
                (identity.user_id, identity.thread_id, session_id,
                 reply_to_turn_id)).fetchone()
            if handoff:
                return False
        inserted = connection.execute('''INSERT INTO uony_live_turns
            (user_id,thread_id,session_id,turn_id,role,text,created_at,reply_to_turn_id,finalized_by)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING text''',
            (identity.user_id, identity.thread_id, session_id, turn_id,
             event.role, event.text.strip(), occurred_at,
             reply_to_turn_id, transcript_source(event.finalized_by))).fetchone()
        if inserted is None:
            previous = connection.execute('''SELECT text,reply_to_turn_id FROM uony_live_turns
                WHERE user_id=%s AND thread_id=%s AND session_id=%s
                    AND turn_id=%s AND role=%s''',
                (identity.user_id, identity.thread_id, session_id, turn_id,
                 event.role)).fetchone()
            if (not previous or previous['text'] != event.text.strip()
                    or previous['reply_to_turn_id'] != reply_to_turn_id):
                raise ValueError('conflicting Live transcript')
            promote_transcript_source(connection, user_id=identity.user_id,
                thread_id=identity.thread_id, session_id=session_id, turn_id=turn_id,
                role=event.role, text=event.text.strip(), finalized_by=event.finalized_by)
            return False
        if event.role == 'user':
            connection.execute('''UPDATE uony_threads SET title=%s
                WHERE user_id=%s AND id=%s AND title='Conversación por voz' ''',
                (event.text.strip()[:70], identity.user_id, identity.thread_id))
        return True


def _current_work(database, identity: LiveIdentity, settings, session_id: str,
                  session_hash: str):
    if (identity.user_id not in settings.live_pilot_user_ids
            or not _session_allowed(database, identity, session_id, session_hash)):
        raise ValueError('Live work access revoked')
    with database.connect() as connection:
        user = connection.execute('''SELECT u.google_subject,u.deletion_requested_at,
            c.google_subject AS cloud_subject,c.project_id,c.status
            FROM users u LEFT JOIN google_cloud_connections c ON c.user_id=u.id
            WHERE u.id=%s''', (identity.user_id,)).fetchone()
        thread = connection.execute('''SELECT deleted_at FROM uony_threads
            WHERE user_id=%s AND id=%s''',
            (identity.user_id, identity.thread_id)).fetchone()
        if (not user or user['deletion_requested_at']
                or user['google_subject'] != identity.google_subject
                or user['cloud_subject'] != identity.google_subject
                or user['project_id'] != identity.project_id
                or user['status'] != 'connected'
                or not thread or thread['deleted_at']):
            raise ValueError('Live work owner unavailable')
        rows = connection.execute('''SELECT label,status,next_step FROM uony_assignments
            WHERE user_id=%s AND google_subject=%s ORDER BY updated_at DESC LIMIT 2''',
            (identity.user_id, identity.google_subject)).fetchall()
        assignments = [{'label': row['label'], 'status': row['status'],
            'nextStep': row['next_step']} for row in rows]
        recent = connection.execute('''SELECT h.turn_id,h.request_id,h.intent,
                j.status AS job_status,r.status AS request_status,r.reply,
                r.product_intake,r.product_proposal,r.conversation_form
            FROM uony_live_handoffs h
            JOIN uony_requests r ON r.user_id=h.user_id AND r.request_id=h.request_id
            LEFT JOIN uony_conversation_jobs j ON j.user_id=h.user_id
                AND j.request_id=h.request_id
            WHERE h.user_id=%s AND h.thread_id=%s AND h.google_subject=%s
              AND h.google_project_id=%s
            ORDER BY h.created_at DESC,h.turn_id DESC LIMIT 1''',
            (identity.user_id, identity.thread_id, identity.google_subject,
             identity.project_id)).fetchone()
        latest = None
        if recent:
            state = recent['job_status'] or recent['request_status']
            card = ('product_intake' if recent['product_intake'] else
                    'product_proposal' if recent['product_proposal'] else
                    'question' if recent['conversation_form'] else None)
            # Status only: no reply preview or Drive content (audit F0.3).
            latest = {'turnId': str(recent['turn_id']),
                'requestId': str(recent['request_id']), 'intent': recent['intent'],
                'status': state, 'cardType': card}
        from .uony_live_materials import latest_material_analysis
        material = latest_material_analysis(connection, identity)
        result = {'status': 'ok' if assignments or latest or material else 'no_results',
            'retryable': False, 'scope': 'account_assignments_and_thread_handoff',
            'assignmentScope': 'account', 'latestHandoffScope': 'current_thread',
            'driveChecked': False,
            'message': ('Encargos de la cuenta y último traspaso de esta conversación.'
                        if assignments or latest or material else
                        'No hay encargos ni traspasos guardados para esta cuenta.'),
            'assignments': assignments, 'latestHandoff': latest}
        if material:
            result['materialAnalysis'] = {key: material[key] for key in
                ('status', 'currentRevision', 'turnId') if key in material}
            result['materialAnalysisScope'] = 'current_thread'
        return result


def _reserve(database, identity: LiveIdentity, session_id: str,
             session_hash: str, session_limit: int | None = None):
    from .uony_session_reservation import reserve
    return reserve(database, identity, session_id, session_hash, session_limit,
        max_active=MAX_ACTIVE_SESSIONS,
        session_seconds=SESSION_SECONDS + SESSION_HANDSHAKE_MARGIN_SECONDS,
        pilot_budget_available=pilot_budget_available)


def _release(database, identity: LiveIdentity, session_id: str):
    with database.connect() as connection:
        # Match heartbeat's reservation-before-snapshot lock order.
        connection.execute('''SELECT session_id FROM uony_live_sessions
            WHERE user_id=%s AND session_id=%s FOR UPDATE''', (identity.user_id, session_id))
        connection.execute('''UPDATE uony_session_continuity SET active=false,
            version=version+1,updated_at=now() WHERE user_id=%s AND session_id=%s AND active''',
            (identity.user_id, session_id))
        connection.execute('''UPDATE uony_live_usage SET state='unknown',updated_at=now()
            WHERE user_id=%s AND session_id=%s AND state='started' ''',
            (identity.user_id, session_id))
        connection.execute('''DELETE FROM uony_live_sessions
            WHERE user_id=%s AND session_id=%s''', (identity.user_id, session_id))


def _abandon_before_provider(database, identity: LiveIdentity, session_id: str):
    """Restore a reserved pilot slot only when no provider call was attempted.

    A failed or interrupted provider call keeps its receipt because Google usage
    may be unknown. This path must never be used after entering live.open().
    """
    with database.connect() as connection:
        connection.execute('''SELECT id FROM users WHERE id=%s FOR SHARE''',
                           (identity.user_id,))
        connection.execute('SELECT pg_advisory_xact_lock(71102026)')
        connection.execute('''DELETE FROM uony_live_usage
            WHERE user_id=%s AND session_id=%s AND state='started' ''',
            (identity.user_id, session_id))
        connection.execute('''DELETE FROM uony_live_sessions
            WHERE user_id=%s AND session_id=%s''', (identity.user_id, session_id))
        connection.execute('''DELETE FROM uony_live_pilot_admissions
            WHERE user_id=%s AND session_id=%s''', (identity.user_id, session_id))


def _record_usage(database, identity: LiveIdentity, session_id: str, event: LiveUsage):
    if not isinstance(event.counts, dict) or len(json.dumps(event.counts)) > 2048:
        raise ValueError('invalid Live usage')
    with database.connect() as connection:
        row = connection.execute('''UPDATE uony_live_usage
            SET usage=coalesce(usage, '{}'::jsonb) || %s,
                state='observed',updated_at=now()
            WHERE user_id=%s AND session_id=%s RETURNING session_id''',
            (Jsonb(event.counts), identity.user_id, session_id)).fetchone()
        if not row:
            raise ValueError('Live usage unavailable')


def _session_allowed(database, identity: LiveIdentity, session_id: str,
                     session_hash: str):
    with database.connect() as connection:
        browser_session = connection.execute('''SELECT 1 FROM sessions
            WHERE user_id=%s AND token_hash=%s AND expires_at>now()''',
            (identity.user_id, session_hash)).fetchone()
        user = connection.execute('''SELECT * FROM users WHERE id=%s''',
                                  (identity.user_id,)).fetchone()
        if (not browser_session or not user or user.get('deletion_requested_at')
                or user['google_subject'] != identity.google_subject
                or not user.get('onboarding_completed_at')
                or workspace_access(connection, user)['status'] != 'allowed'):
            return False
        row = connection.execute('''SELECT google_subject,project_id,status,
            project_check,scope FROM google_cloud_connections WHERE user_id=%s''',
            (identity.user_id,)).fetchone()
        reserved = connection.execute('''SELECT session_id FROM uony_live_sessions
            WHERE user_id=%s AND thread_id=%s AND expires_at>now()
              AND heartbeat_at>now()-(%s*interval '1 second')''',
            (identity.user_id, identity.thread_id, RECLAIM_AFTER_SECONDS)).fetchone()
        thread = connection.execute('''SELECT deleted_at FROM uony_threads
            WHERE user_id=%s AND id=%s''',
            (identity.user_id, identity.thread_id)).fetchone()
        return bool(row and row['google_subject'] == identity.google_subject
            and row['project_id'] == identity.project_id and row['status'] == 'connected'
            and (row['project_check'] or {}).get('ready')
            and SCOPE in (row['scope'] or '').split()
            and reserved and str(reserved['session_id']) == session_id
            and thread and not thread['deleted_at'])


def routes(settings, database, live: LiveProvider | None = None):
    # Keep the public import stable for the API and legacy offline tests.
    from .uony_live_routes import routes as build_routes
    return build_routes(settings, database, live)
