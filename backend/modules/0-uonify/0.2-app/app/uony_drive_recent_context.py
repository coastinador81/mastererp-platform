"""Infer Drive from a nearby customer turn, never from a model answer."""

import re
from datetime import timedelta


def _same_drive_identity(turn, google_subject, google_project_id, live_session_id):
    return ((turn['project_id'] == google_project_id and
             turn['google_subject'] == google_subject) or
            (live_session_id is not None and
             turn['session_id'] == live_session_id))


def _brief_live_interjection(turn, live_session_id):
    """Only an isolated «¿Yo?» may be skipped; it grants no Drive scope."""
    return (live_session_id is not None and
            turn['session_id'] == live_session_id and
            re.fullmatch(r'\s*¿?\s*yo\s*[?.]?\s*',
                         turn['text'].casefold()) is not None)


def preceding_user_mentions_drive(connection, user_id, thread_id,
                                  google_subject, google_project_id, before,
                                  *, live_session_id=None):
    """Model replies cannot establish context; a topic switch ends it.

    A routed Live utterance is represented by its request, not counted twice.
    One neutral Live interjection in the current session may be skipped when
    the previous Drive turn is recent and tied to this Google identity.
    """
    previous = connection.execute('''SELECT text,project_id,google_subject,
        session_id,created_at FROM (
        SELECT r.prompt AS text,r.project_id,
          COALESCE(h.google_subject,j.google_subject) AS google_subject,
          NULL::uuid AS session_id,
          COALESCE(rv.created_at,r.created_at) AS created_at FROM uony_requests r
        LEFT JOIN uony_live_handoffs h ON h.user_id=r.user_id
          AND h.request_id=r.request_id
        LEFT JOIN uony_live_turns rv ON rv.user_id=h.user_id
          AND rv.thread_id=h.thread_id AND rv.session_id=h.session_id
          AND rv.turn_id=h.turn_id AND rv.role='user'
        LEFT JOIN uony_conversation_jobs j ON j.user_id=r.user_id
          AND j.request_id=r.request_id
        WHERE r.user_id=%s AND r.thread_id=%s
          AND COALESCE(rv.created_at,r.created_at) < %s
        UNION ALL
        SELECT v.text,NULL::text AS project_id,NULL::text AS google_subject,
          v.session_id,v.created_at FROM uony_live_turns v
        LEFT JOIN uony_live_handoffs h ON h.user_id=v.user_id
          AND h.thread_id=v.thread_id AND h.session_id=v.session_id
          AND h.turn_id=v.turn_id
        WHERE v.user_id=%s AND v.thread_id=%s AND v.role='user'
          AND v.created_at < %s AND h.request_id IS NULL
    ) turns ORDER BY created_at DESC LIMIT 2''',
        (user_id,thread_id,before,user_id,thread_id,before)).fetchall()
    if not previous:
        return False
    nearest = previous[0]
    if (before - nearest['created_at'] <= timedelta(seconds=90) and
            _same_drive_identity(nearest,google_subject,google_project_id,
                             live_session_id) and
            re.search(r'\bdrive\b',nearest['text'].casefold())):
        return True
    if (len(previous) != 2 or
            not _brief_live_interjection(nearest,live_session_id) or
            before - nearest['created_at'] > timedelta(seconds=30)):
        return False
    prior = previous[1]
    return bool(before - prior['created_at'] <= timedelta(seconds=90) and
        _same_drive_identity(prior,google_subject,google_project_id,
                             live_session_id) and
        re.search(r'\bdrive\b',prior['text'].casefold()))


def before_request(connection, user_id, request_id, thread_id,
                   google_subject, google_project_id, *, live_session_id=None):
    current = connection.execute('''SELECT
          COALESCE(rv.created_at,r.created_at) AS created_at
        FROM uony_requests r
        LEFT JOIN uony_live_handoffs h ON h.user_id=r.user_id
          AND h.request_id=r.request_id
        LEFT JOIN uony_live_turns rv ON rv.user_id=h.user_id
          AND rv.thread_id=h.thread_id AND rv.session_id=h.session_id
          AND rv.turn_id=h.turn_id AND rv.role='user'
        WHERE r.user_id=%s AND r.request_id=%s AND r.thread_id=%s
          AND r.project_id=%s''',
        (user_id,request_id,thread_id,google_project_id)).fetchone()
    return bool(current and preceding_user_mentions_drive(connection,user_id,
        thread_id,google_subject,google_project_id,current['created_at'],
        live_session_id=live_session_id))


def before_live_turn(connection, identity, text, *, turn_id=None):
    if turn_id is None:
        current = connection.execute('''SELECT turn_id,session_id,text,created_at
            FROM uony_live_turns WHERE user_id=%s AND thread_id=%s AND role='user'
            ORDER BY created_at DESC,turn_id DESC LIMIT 1''',
            (identity.user_id,identity.thread_id)).fetchone()
    else:
        current = connection.execute('''SELECT turn_id,session_id,text,created_at
            FROM uony_live_turns WHERE user_id=%s AND thread_id=%s AND role='user'
              AND turn_id=%s ORDER BY created_at DESC LIMIT 1''',
            (identity.user_id,identity.thread_id,turn_id)).fetchone()
    if not current or current['text'] != text.strip():
        return False
    # The context must be computed for the newest persisted user turn, not an
    # older repeated phrase passed through a delayed model/tool event.
    newest = connection.execute('''SELECT turn_id FROM uony_live_turns
        WHERE user_id=%s AND thread_id=%s AND role='user'
        ORDER BY created_at DESC,turn_id DESC LIMIT 1''',
        (identity.user_id,identity.thread_id)).fetchone()
    if not newest or newest['turn_id'] != current['turn_id']:
        return False
    return preceding_user_mentions_drive(connection,identity.user_id,
        identity.thread_id,identity.google_subject,identity.project_id,
        current['created_at'],live_session_id=current['session_id'])
