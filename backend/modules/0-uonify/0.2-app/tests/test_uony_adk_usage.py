"""A failed model attempt retains an honest, bounded usage record."""

from uuid import uuid4

from app.google_cloud_provider import CloudError
from conftest import client_for
from test_google_cloud import Cloud
from test_products import connect
from test_uony import ready


class UncertainProvider:
    def generate(self, *args, **kwargs):
        error = CloudError('quota_exceeded')
        error.usage = {
            'calls': 0,
            'attemptedCalls': 1,
            'uncertainCalls': 1,
            'totalTokenCount': 0,
            'formRepairCalls': 0,
            'providerDetail': 'never-persist-me',
            'invalidCount': -1,
        }
        raise error


def test_uncertain_attempt_is_saved_without_provider_detail_or_retry(environment):
    config, google, db = environment
    with client_for(config, google, cloud=Cloud(), uony=UncertainProvider()) as client:
        ready(client, google, db)
        connect(db, config)
        body = {'requestId': str(uuid4()), 'threadId': 'adk-usage', 'text': 'Hola'}
        response = client.post('/api/uony/messages', json=body)
        assert response.status_code == 503 and response.json()['error'] == 'consumption_unknown'
        assert client.post('/api/uony/messages', json=body).status_code == 409
        with db.connect() as connection:
            row = connection.execute(
                'SELECT status,usage FROM uony_requests WHERE request_id=%s',
                (body['requestId'],),
            ).fetchone()
            assert row['status'] == 'error'
            assert row['usage'] == {
                'calls': 0,
                'attemptedCalls': 1,
                'uncertainCalls': 1,
                'totalTokenCount': 0,
                'formRepairCalls': 0,
            }
