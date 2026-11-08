"""A qualified, fixed semantic model for one explicit local pilot binding.

This resolver neither selects the conversation model nor verifies OAuth. Its
caller supplies freshly validated rows again after OAuth and before acceptance.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
from uuid import UUID

from .google_cloud_provider import CloudError

MODEL = 'gemini-3.5-flash-lite'
THINKING_LEVEL = 'LOW'
MAX_CONFIG_BYTES = 4096
SOURCE_NAMES = ('uony_semantic_classifier.py', 'uony_semantic_decision.py',
                'uony_adk_provider.py', 'uony_provider.py', 'uony_drive_instruction.py')
CONFIG_KEYS = frozenset({'version', 'userId', 'workspaceProjectId', 'googleSubject',
    'googleProjectId', 'connectionFingerprint', 'model', 'thinkingLevel',
    'sourceHashes', 'qualifiedAt'})
SHA256 = re.compile(r'[0-9a-f]{64}')
IDENTIFIER = re.compile(r'[A-Za-z0-9._:-]{1,255}')
TIMESTAMP = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})')


@dataclass(frozen=True, repr=False)
class SemanticModelPilot:
    user_id: str
    workspace_project_id: str
    google_subject: str
    google_project_id: str
    connection_fingerprint: str
    model: str
    thinking_level: str
    source_hashes: tuple[tuple[str, str], ...]
    qualified_at: datetime


def source_hashes():
    """Only the five fixed local sources qualified by the offline/real gate."""
    return {name: sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
            for name in SOURCE_NAMES}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate configuration key')
        result[key] = value
    return result


def _uuid(value):
    if not isinstance(value, str) or str(UUID(value)) != value:
        raise ValueError('noncanonical UUID')
    return value


def load_semantic_model_pilot(directory, adk_user_ids, test_project_ids):
    """Absent means off; an explicit malformed or unqualified file fails closed."""
    path = Path(directory) / 'semantic-model-pilot.json'
    try:
        with path.open('rb') as handle:
            raw = handle.read(MAX_CONFIG_BYTES + 1)
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise RuntimeError('El piloto local del modelo semántico no es válido') from exc
    try:
        if len(raw) > MAX_CONFIG_BYTES:
            raise ValueError('configuration too large')
        data = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_object)
        if (not isinstance(data, dict) or set(data) != CONFIG_KEYS
                or type(data['version']) is not int or data['version'] != 1):
            raise ValueError('invalid schema')
        user_id, project_id = _uuid(data['userId']), _uuid(data['workspaceProjectId'])
        if user_id not in adk_user_ids or project_id not in test_project_ids:
            raise ValueError('binding outside the local test pilot')
        if any(not isinstance(data[key], str) or not IDENTIFIER.fullmatch(data[key])
               for key in ('googleSubject', 'googleProjectId')):
            raise ValueError('invalid Google binding')
        if (data['model'] != MODEL or data['thinkingLevel'] != THINKING_LEVEL
                or not isinstance(data['connectionFingerprint'], str)
                or not SHA256.fullmatch(data['connectionFingerprint'])):
            raise ValueError('invalid qualified model or connection')
        hashes = data['sourceHashes']
        if (not isinstance(hashes, dict) or set(hashes) != set(SOURCE_NAMES)
                or any(not isinstance(value, str) or not SHA256.fullmatch(value)
                       for value in hashes.values()) or hashes != source_hashes()):
            raise ValueError('candidate sources differ from the qualification')
        stamp = data['qualifiedAt']
        if not isinstance(stamp, str) or not TIMESTAMP.fullmatch(stamp):
            raise ValueError('invalid qualification date')
        qualified = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
        if qualified.tzinfo is None or qualified > datetime.now(timezone.utc):
            raise ValueError('invalid qualification date')
        return SemanticModelPilot(user_id, project_id, data['googleSubject'],
            data['googleProjectId'], data['connectionFingerprint'], data['model'],
            data['thinkingLevel'], tuple(sorted(hashes.items())), qualified)
    except (OSError, ValueError, TypeError, KeyError, UnicodeError) as exc:
        raise RuntimeError('El piloto local del modelo semántico no es válido') from exc


def semantic_model(settings, user, cloud, workspace_project_id, conversation_model):
    """Outside the exact pilot retain conversation choice; inside never fall back."""
    pilot = getattr(settings, 'semantic_model_pilot', None)
    if pilot is None:
        return conversation_model
    if not isinstance(pilot, SemanticModelPilot):
        raise CloudError('model_changed')
    if (str(user['id']) != pilot.user_id
            or str(workspace_project_id) != pilot.workspace_project_id):
        return conversation_model
    try:
        from .uony_followup_store import fingerprint
        if (pilot.user_id not in settings.adk_pilot_user_ids
                or pilot.workspace_project_id not in settings.test_project_ids
                or user['google_subject'] != pilot.google_subject
                or str(cloud['user_id']) != pilot.user_id
                or cloud['google_subject'] != pilot.google_subject
                or cloud['project_id'] != pilot.google_project_id
                or cloud['status'] != 'connected'
                or not isinstance(cloud.get('project_check'), dict)
                or cloud['project_check'].get('ready') is not True
                or fingerprint(cloud) != pilot.connection_fingerprint
                or pilot.model != MODEL or pilot.thinking_level != THINKING_LEVEL
                or dict(pilot.source_hashes) != source_hashes()):
            raise CloudError('model_changed')
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        raise CloudError('model_changed') from None
    return pilot.model
