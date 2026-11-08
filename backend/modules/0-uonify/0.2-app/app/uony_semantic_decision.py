"""Bounded semantic routing: a model chooses intent, the server owns effects.

Only server-created envelopes are accepted from the handoff table. Neither this
schema nor a model quote is accepted from Message/other client request payloads.
"""
from hashlib import sha256
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator
from .google_cloud_provider import CloudError
from .uony_drive_instruction import DriveInstruction

Action = Literal['conversation', 'drive_access', 'drive_count', 'drive_search',
                 'drive_analyze', 'drive_assist', 'work_status', 'clarify', 'create_product',
                 'creative_plan', 'recover_request']
DriveAction = Literal['drive_access', 'drive_count', 'drive_search', 'drive_analyze']
DRIVE_ACTIONS = frozenset(('drive_access', 'drive_count', 'drive_search', 'drive_analyze'))


class SemanticTarget(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, frozen=True)
    folder_id: str | None = Field(default=None, min_length=1, max_length=200,
                                  pattern=r'^[A-Za-z0-9_-]+$')
    folder_name: str | None = Field(default=None, min_length=1, max_length=120)
    use_selected: bool = False

    @model_validator(mode='after')
    def one_target(self):
        if sum((bool(self.folder_id), bool(self.folder_name), self.use_selected)) > 1:
            raise ValueError('one_target_required')
        return self

    @property
    def present(self):
        return bool(self.folder_id or self.folder_name or self.use_selected)


class SemanticDecision(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, frozen=True)
    action: Action
    request_mode: Literal['execute', 'status', 'discuss', 'clarify', 'recover']
    current_request: bool = Field(description=(
        'False for conversation, including negation, quotation and information '
        'without an operational request; true for other actions.'))
    evidence: str = Field(max_length=3000)
    target: SemanticTarget = Field(default_factory=SemanticTarget)
    status_action: DriveAction | None = None
    clarification: str | None = Field(default=None, min_length=1, max_length=240)
    recovery_reference: Literal['previous_request'] | None = None
    _usage: dict = PrivateAttr(default_factory=dict)

    @property
    def usage(self):
        return dict(self._usage)

    @model_validator(mode='after')
    def bounded_operation(self):
        modes = {'conversation': 'discuss', 'work_status': 'status', 'clarify': 'clarify',
                 'recover_request': 'recover'}
        required = modes.get(self.action, 'execute')
        if self.request_mode != required:
            raise ValueError('action_mode_mismatch')
        if self.action == 'conversation' and self.current_request:
            raise ValueError('conversation_cannot_authorize_action')
        if self.action not in ('conversation', 'clarify') and not self.current_request:
            raise ValueError('current_request_required')
        if self.action in ('drive_access', 'drive_count') and self.target.present:
            raise ValueError('metadata_scope_is_connected_account_only')
        if self.action in ('drive_search', 'drive_analyze') and not self.target.present:
            raise ValueError('folder_required')
        if self.action not in ('drive_search', 'drive_analyze') and self.target.present:
            raise ValueError('unexpected_folder')
        if self.action == 'work_status' and self.status_action is None:
            raise ValueError('status_action_required')
        if self.action != 'work_status' and self.status_action is not None:
            raise ValueError('unexpected_status_action')
        if self.action != 'clarify' and self.clarification is not None:
            raise ValueError('unexpected_clarification')
        if (self.action == 'recover_request') != (self.recovery_reference == 'previous_request'):
            raise ValueError('recovery_reference_required')
        return self

    def drive_instruction(self):
        action = {'drive_access': 'access', 'drive_count': 'count_folders',
                  'drive_search': 'search', 'drive_analyze': 'analyze'}.get(self.action)
        return DriveInstruction(action, **self.target.model_dump()) if action else None


def _user_texts(history):
    texts = []
    for item in list(history or ())[-8:]:
        if not isinstance(item, dict) or item.get('role') != 'user':
            continue
        value = item.get('text')
        if value is None:
            value = '\n'.join(part['text'] for part in item.get('parts', ())
                             if isinstance(part, dict) and isinstance(part.get('text'), str))
        if isinstance(value, str):
            texts.append(value[:3000])
    return texts


def validate_decision(value, text, *, history=(), selected_folder=None):
    """Validate structure and target provenance without an utterance grammar."""
    try:
        decision = SemanticDecision.model_validate(value)
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 3000:
            raise ValueError('invalid_current_text')
        # Require the full current utterance, not a convenient quoted fragment.
        if decision.evidence != text.strip():
            raise ValueError('current_turn_evidence_mismatch')
        target = decision.target
        references = [text, *_user_texts(history)]
        if target.folder_id and not any(target.folder_id in source for source in references):
            raise ValueError('ungrounded_folder_id')
        if target.folder_name and not any(target.folder_name.casefold() in source.casefold()
                                          for source in references):
            raise ValueError('ungrounded_folder_name')
        if target.use_selected and not (isinstance(selected_folder, dict)
                                        and selected_folder.get('id')):
            raise ValueError('missing_selected_folder')
        if target.use_selected:
            # Freeze the selected resource now. A later UI selection must not
            # retarget a queued instruction to different documents.
            decision = decision.model_copy(update={'target': SemanticTarget(
                folder_id=str(selected_folder['id']))})
        return decision
    except (TypeError, ValueError):
        raise CloudError('invalid_response') from None


def serialize_decision(decision, text):
    if decision.evidence != text.strip():
        raise CloudError('invalid_response')
    return {'version': 1, 'text_sha256': sha256(text.encode()).hexdigest(),
            'decision': decision.model_dump()}


def restore_decision(value, text, *, selected_folder=None):
    """Restore trusted DB state; never called with a client-supplied envelope."""
    if (not isinstance(value, dict) or set(value) != {'version', 'text_sha256', 'decision'}
            or type(value['version']) is not int or value['version'] != 1
            or value['text_sha256'] != sha256(text.encode()).hexdigest()):
        raise CloudError('invalid_response')
    try:
        decision = SemanticDecision.model_validate(value['decision'])
        if decision.evidence != text.strip():
            raise ValueError('current_turn_evidence_mismatch')
        if decision.target.use_selected and not (selected_folder or {}).get('id'):
            raise ValueError('selected_folder_unavailable')
        return decision
    except (TypeError, ValueError):
        raise CloudError('invalid_response') from None
