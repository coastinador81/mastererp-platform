"""Scope a short spoken Drive follow-up to the customer's prior turn."""

from .uony_drive_instruction import parse_drive_instruction
from .uony_drive_recent_context import before_live_turn
from .uony_live_delivery import explicit_intent


def immediate_drive_context(database, identity, current_text, *, turn_id=None):
    """A model answer cannot widen the user's bounded count instruction."""
    with database.connect() as connection:
        return before_live_turn(connection,identity,current_text,turn_id=turn_id)


def metadata_turn_allowed(database, identity, event):
    """Allow a bounded access/count question, never search or analysis."""
    if event.finalized_by != 'read_only_boundary':
        return False
    direct = parse_drive_instruction(event.text)
    if direct and direct.action in ('access', 'count_folders'):
        return True
    if not immediate_drive_context(database, identity, event.text,
                                   turn_id=event.turn_id):
        return False
    contextual = parse_drive_instruction(event.text, drive_context=True)
    return contextual is not None and contextual.action == 'count_folders'


def contextual_intent(database, identity, text, *, creative_follow_up=False,
                      turn_id=None):
    intent = explicit_intent(text)
    if intent:
        return intent
    contextual = parse_drive_instruction(text, drive_context=True)
    if (contextual is not None and contextual.action == 'count_folders' and
            immediate_drive_context(database, identity, text,turn_id=turn_id)):
        return 'use_drive_materials'
    return explicit_intent(text, creative_follow_up=True) if creative_follow_up else None
