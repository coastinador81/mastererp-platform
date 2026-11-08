"""Allow a VAD-bounded, unconfirmed transcript to request access metadata only."""

from .uony_drive_instruction import parse_drive_instruction


def may_probe_drive_access(event):
    if event.finalized_by != 'read_only_boundary':
        return False
    directive = parse_drive_instruction(event.text)
    return directive is not None and directive.action == 'access'
