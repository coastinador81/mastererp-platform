"""Persist observed transcript provenance without turning captions into consent.

Only a later primary event with the same exact words can improve a saved
source. Callers must still validate the selected action and its scope; a
semantic decision itself is never transcription evidence.
"""

PRIMARY_METADATA_SOURCES = frozenset({
    'provider_finished', 'read_only_boundary', 'primary_vad_closed',
})
# These sources support the bounded read/proposal capabilities in the semantic
# catalog. They are not blanket permission for destructive or external writes.
PRIMARY_ACTION_SOURCES = frozenset({'provider_finished', 'primary_vad_closed'})
# Metadata actions of the semantic catalog: a primary read-only boundary is
# enough evidence for them. One list for the router, admission, late reads and
# the worker. drive_assist can read documents, so it is NOT here (audit
# C-DRIVE/F0.2, 20-10-2026): reading needs the stronger primary final.
METADATA_ACTIONS = frozenset({'drive_access', 'drive_count', 'work_status'})
# Typed Drive operations (uony_drive_scope): only `read` opens content.
METADATA_OPERATIONS = frozenset({'access', 'count', 'list'})


def voice_action_allowed(action, finalized_by):
    """Whether a final transcript's source may start this semantic action."""
    if action == 'clarify':
        return True
    sources = PRIMARY_METADATA_SOURCES if action in METADATA_ACTIONS else PRIMARY_ACTION_SOURCES
    return finalized_by in sources
_SOURCE_RANK = {'': 0, 'caption_recovery': 1, 'reply_boundary': 1,
                'model_turn_complete': 2, 'read_only_boundary': 3,
                'primary_vad_closed': 3, 'provider_finished': 4}


def transcript_source(value):
    """Reject unknown source names rather than silently assigning authority."""
    if not isinstance(value, str) or value not in _SOURCE_RANK:
        raise ValueError('invalid Live transcript provenance')
    return value


def promoted_source(previous, incoming):
    """Never downgrade or replace evidence with an equal-strength source."""
    previous, incoming = transcript_source(previous), transcript_source(incoming)
    return incoming if _SOURCE_RANK[incoming] > _SOURCE_RANK[previous] else previous


def promote_transcript_source(connection, *, user_id, thread_id, session_id,
                              turn_id, role, text, finalized_by):
    """Corroborate a duplicate transcript under its full owner/session key.

    This helper must receive only server-observed primary/caption events,
    never a model-proposed source. The row lock makes duplicate sockets
    converge without losing an already stronger source.
    """
    source = transcript_source(finalized_by)
    if role not in ('user', 'assistant') or not isinstance(text, str):
        raise ValueError('invalid Live transcript provenance target')
    row = connection.execute('''SELECT text,finalized_by FROM uony_live_turns
        WHERE user_id=%s AND thread_id=%s AND session_id=%s AND turn_id=%s
          AND role=%s FOR UPDATE''',
        (user_id, thread_id, session_id, turn_id, role)).fetchone()
    if not row or row['text'] != text.strip():
        raise ValueError('conflicting Live transcript provenance')
    result = promoted_source(row['finalized_by'], source)
    if result != row['finalized_by']:
        connection.execute('''UPDATE uony_live_turns SET finalized_by=%s
            WHERE user_id=%s AND thread_id=%s AND session_id=%s AND turn_id=%s
              AND role=%s''',
            (result, user_id, thread_id, session_id, turn_id, role))
    return result
