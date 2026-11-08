"""La recuperación Omni consulta una interacción existente una sola vez."""

from base64 import b64encode
from pathlib import Path

import pytest
import requests

from app.creative_omni_recovery import OmniRecoveryUnknown, poll_omni_once


PROJECT = 'uonify-757ec8c3ab3245ffa45d'
INTERACTION = 'interaction_test_123'
VIDEO = (Path(__file__).resolve().parents[2] / 'artifacts' /
         'creative-model-audit-20261018' / 'google-results' /
         'gemini-omni-1.1-flash-preview-1.mp4').read_bytes()


class Response:
    def __init__(self, status, body):
        self.status_code, self.body, self.closed = status, body, False

    def json(self):
        return self.body

    def close(self):
        self.closed = True


class Session:
    def __init__(self, response):
        self.response, self.calls = response, []

    def request(self, method, url, **options):
        self.calls.append((method, url, options))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


def test_pending_interaction_is_read_once_without_generation():
    response = Response(200, {'status': 'in_progress'})
    session = Session(response)
    result = poll_omni_once(PROJECT, INTERACTION, 'offline-token', session)
    assert result.status == 'in_progress' and result.outputs == ()
    assert [call[0] for call in session.calls] == ['GET'] and response.closed
    assert session.calls[0][1].endswith('/interactions/' + INTERACTION)


def test_completed_interaction_normalizes_existing_video():
    payload = {'model': 'gemini-omni-1.1-flash-preview', 'status': 'completed',
               'steps': [{'type': 'model_output', 'content': [{
                   'type': 'video', 'mime_type': 'video/mp4',
                   'data': b64encode(VIDEO).decode()}]}]}
    result = poll_omni_once(PROJECT, INTERACTION, 'offline-token',
                            Session(Response(200, payload)))
    assert result.status == 'completed' and len(result.outputs) == 1
    assert (result.outputs[0].width_pixels, result.outputs[0].height_pixels) == (640, 360)


def test_completed_background_interaction_accepts_only_the_reserved_gcs_prefix():
    payload = {'model': 'gemini-omni-1.1-flash-preview', 'status': 'completed',
               'steps': [{'type': 'model_output', 'content': [{
                   'type': 'video', 'mime_type': 'video/mp4',
                   'uri': 'gs://private-bucket/creative/attempt/output.mp4'}]}]}
    result = poll_omni_once(
        PROJECT, INTERACTION, 'offline-token', Session(Response(200, payload)),
        expected_output_prefix='gs://private-bucket/creative/attempt/')
    assert result.outputs[0].uri.endswith('/output.mp4')
    with pytest.raises(OmniRecoveryUnknown):
        poll_omni_once(
            PROJECT, INTERACTION, 'offline-token', Session(Response(200, payload)),
            expected_output_prefix='gs://private-bucket/creative/other/')


def test_uncertain_recovery_never_sends_a_second_request():
    for response in (requests.Timeout(), Response(503, {}),
                     Response(200, {'status': 'failed'}),
                     Response(200, {'status': 'completed', 'steps': []})):
        session = Session(response)
        with pytest.raises(OmniRecoveryUnknown):
            poll_omni_once(PROJECT, INTERACTION, 'offline-token', session)
        assert len(session.calls) == 1
