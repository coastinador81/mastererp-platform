"""Bounded SSE transport for Vertex streamGenerateContent.

This only assembles a model turn. The caller remains responsible for tools,
usage accounting, durable reservations, and committing the final reply.
"""
import json

from .google_cloud_provider import CloudError


MAX_EVENT_BYTES = 65536
MAX_VISIBLE_CHARS = 16000


def _events(lines):
    data = []
    size = 0
    for line in lines:
        if isinstance(line, bytes):
            line = line.decode('utf-8')
        if not isinstance(line, str):
            raise CloudError('invalid_response')
        if not line:
            if data:
                yield '\n'.join(data)
                data = []
                size = 0
            continue
        if line.startswith(':'):
            continue
        if line.startswith('data:'):
            value = line[5:].lstrip(' ')
            size += len(value.encode('utf-8'))
            if size > MAX_EVENT_BYTES:
                raise CloudError('invalid_response')
            data.append(value)
        elif line.startswith(('event:', 'id:', 'retry:')):
            continue
        else:
            raise CloudError('invalid_response')
    if data:
        yield '\n'.join(data)


def collect_stream(response, on_text=None, on_clear=None):
    """Return the unary-shaped result, exposing only tentative non-thought text.

    Google sends incremental parts; function-call arguments are deliberately
    not requested as partialArgs. An unsafe/malformed stream is rejected, never
    converted into an apparently complete answer.
    """
    content_type = response.headers.get('Content-Type', '').lower()
    if 'text/event-stream' not in content_type:
        raise CloudError('invalid_response')
    parts = []
    visible = ''
    finish = None
    usage = {}
    saw_call = False
    saw_event = False
    for raw in _events(response.iter_lines(decode_unicode=True)):
        if raw == '[DONE]':
            break
        event = json.loads(raw)
        if not isinstance(event, dict):
            raise CloudError('invalid_response')
        saw_event = True
        candidates = event.get('candidates', [])
        if not isinstance(candidates, list) or len(candidates) > 1:
            raise CloudError('invalid_response')
        if candidates:
            candidate = candidates[0]
            if not isinstance(candidate, dict) or candidate.get('index', 0) != 0:
                raise CloudError('invalid_response')
            content = candidate.get('content') or {}
            if not isinstance(content, dict) or content.get('role', 'model') != 'model':
                raise CloudError('invalid_response')
            incoming = content.get('parts', [])
            if not isinstance(incoming, list):
                raise CloudError('invalid_response')
            for part in incoming:
                if not isinstance(part, dict):
                    raise CloudError('invalid_response')
                call = part.get('functionCall')
                if call is not None:
                    if not isinstance(call, dict) or not isinstance(call.get('name'), str) or \
                            'partialArgs' in call or call.get('willContinue'):
                        raise CloudError('invalid_response')
                    if not saw_call and visible and on_clear:
                        on_clear()
                    saw_call = True
                elif 'text' in part:
                    if not isinstance(part['text'], str):
                        raise CloudError('invalid_response')
                    if not part.get('thought') and not saw_call:
                        visible += part['text']
                        if len(visible) > MAX_VISIBLE_CHARS:
                            raise CloudError('invalid_response')
                        if visible and on_text:
                            on_text(visible)
                else:
                    raise CloudError('invalid_response')
                if 'text' in part and 'thoughtSignature' not in part and parts and \
                        'text' in parts[-1] and 'thoughtSignature' not in parts[-1] and \
                        bool(parts[-1].get('thought')) == bool(part.get('thought')):
                    parts[-1]['text'] += part['text']
                else:
                    parts.append(dict(part))
            reason = candidate.get('finishReason')
            if reason is not None:
                if finish is not None or reason not in ('STOP', 'MAX_TOKENS'):
                    raise CloudError('invalid_response')
                finish = reason
        metadata = event.get('usageMetadata')
        if metadata is not None:
            if not isinstance(metadata, dict):
                raise CloudError('invalid_response')
            usage = metadata
    if not saw_event or finish is None or not parts:
        raise CloudError('invalid_response')
    return {'candidates': [{'content': {'role': 'model', 'parts': parts},
                            'finishReason': finish}], 'usageMetadata': usage}
