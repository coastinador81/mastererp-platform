"""Adapter contract tests; DB authorization is covered by effective-role SQL/DEV tests."""
from contextlib import contextmanager
import json
import unittest
from unittest.mock import patch
import purchases


class PurchasesTest(unittest.TestCase):
    def event(self, method='GET', path='solicitudes', body=None):
        return {'rawPath': '/v1/administration/compras/' + path,
                'requestContext': {'http': {'method': method}},
                'headers': {'X-MasterERP-Tenant-Id': '00008702-0000-0000-0000-000000000001', 'Idempotency-Key': 'qa-key'},
                'queryStringParameters': {'company_id': '00008703-0000-0000-0000-000000000001'} if method == 'GET' else {},
                'body': json.dumps(body) if body else None}

    def test_existing_health(self):
        response = purchases.handle(self.event(path='health'), None)
        self.assertEqual(response['statusCode'], 200)
        self.assertEqual(json.loads(response['body']), {'status': 'ok', 'lambda': 'mastererp-dev-adm-compras'})

    def test_missing_auth_does_not_connect(self):
        with patch.object(purchases, 'authenticated_identity', side_effect=purchases.AccessError(401, 'authentication_required')), patch.object(purchases, 'application_connection') as database:
            self.assertEqual(purchases.handle(self.event(), None)['statusCode'], 401)
            database.assert_not_called()

    def test_database_deny_is_403(self):
        @contextmanager
        def denied(**kwargs):
            raise Exception({'C': '42501', 'M': 'sensitive-row-must-not-escape'})
            yield
        with patch.object(purchases, 'authenticated_identity', return_value=('issuer', 'subject')), patch.object(purchases, 'application_connection', denied):
            response = purchases.handle(self.event(), None)
            self.assertEqual(response['statusCode'], 403)
            self.assertNotIn('sensitive', response['body'])

    def test_bad_version_does_not_connect(self):
        event = self.event('PATCH', 'ordenes/00008704-0000-0000-0000-000000000001',
                           {'company_id': '00008703-0000-0000-0000-000000000001', 'version': True, 'documento': {}})
        with patch.object(purchases, 'authenticated_identity', return_value=('issuer', 'subject')), patch.object(purchases, 'application_connection') as database:
            self.assertEqual(purchases.handle(event, None)['statusCode'], 400)
            database.assert_not_called()


if __name__ == '__main__':
    unittest.main()
