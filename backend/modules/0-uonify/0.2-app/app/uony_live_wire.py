"""Small, content-free Vertex Live transport helpers."""
import json


def _vertex_uri(location):
    # Match the installed Google Gen AI SDK's Vertex Live endpoint.
    host = (f'aiplatform.{location}.rep.googleapis.com' if location in ('eu', 'us')
            else f'{location}-aiplatform.googleapis.com')
    return (f'wss://{host}/ws/google.cloud.aiplatform.v1beta1.'
            'LlmBidiService/BidiGenerateContent')


def _decode_message(message):
    if isinstance(message, bytes):
        try:
            message = message.decode('utf-8')
        except UnicodeDecodeError:
            raise ValueError('invalid Live encoding') from None
    elif not isinstance(message, str):
        raise ValueError('non-json Live response')
    try:
        data = json.loads(message)
    except json.JSONDecodeError:
        raise ValueError('invalid Live JSON') from None
    if not isinstance(data, dict):
        raise ValueError('invalid Live response')
    return data


def _stream_envelope(data):
    # Provider values may contain account details; this is a fixed vocabulary.
    return next((key for key in ('error', 'serverContent', 'toolCall',
        'toolCallCancellation', 'interimInputTranscription', 'inputTranscription', 'outputTranscription',
        'usageMetadata', 'goAway', 'sessionResumptionUpdate', 'setupComplete',
        'voiceActivity', 'voiceActivityDetectionSignal')
        if key in data), 'other')


def _stream_close_code(error, websocket):
    frame = getattr(error, 'rcvd', None) or getattr(error, 'sent', None)
    code = getattr(frame, 'code', None) if frame is not None else getattr(websocket, 'close_code', None)
    return code if type(code) is int and 1000 <= code <= 4999 else 'none'
