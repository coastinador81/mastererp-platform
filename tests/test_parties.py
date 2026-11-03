"""Local request-contract tests. Gateway identity and database doubles are tests only."""
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT/'backend/shared/tenant-security'),
               str(ROOT/'backend/modules/2.2-finance/2.2.1-administration/shared')]
import parties

ACTOR = '00000001-0000-0000-0000-000000000001'
TENANT = '00000002-0000-0000-0000-000000000001'
COMPANY = '00000003-0000-0000-0000-000000000001'


class PartiesTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, COGNITO_ISSUER='https://unit.invalid', COGNITO_APP_CLIENT_ID='unit')
        self.env.start()
        self.addCleanup(self.env.stop)

    def event(self, method='GET'):
        return {'rawPath':'/v1/administration/clientes', 'requestContext':{'http':{'method':method},
                'authorizer':{'jwt':{'claims':{'iss':'https://unit.invalid','client_id':'unit',
                    'sub':'synthetic','token_use':'access','scope':'mastererp-dev/identity.spaces.read'}}}},
                'headers':{'x-mastererp-tenant-id':TENANT}, 'queryStringParameters':{'company_id':COMPANY}}

    def call(self, event):
        return parties.handle(event, None, role='cliente', capability='clientes')

    def test_health_has_no_database_dependency(self):
        with patch.object(parties,'application_connection') as connect:
            self.assertEqual(self.call({'rawPath':'/v1/administration/clientes/health','requestContext':{'http':{'method':'GET'}}})['statusCode'],200)
            connect.assert_not_called()

    def test_missing_authentication_is_401(self):
        event=self.event();event['requestContext'].pop('authorizer')
        self.assertEqual(self.call(event)['statusCode'],401)

    def test_invalid_input_does_not_open_connection(self):
        event=self.event('POST');event['body']=json.dumps({'company_id':COMPANY,'codigo':'x','nombre':'Name','unexpected':True})
        with patch.object(parties,'application_connection') as connect:
            self.assertEqual(self.call(event)['statusCode'],400)
            connect.assert_not_called()

    def test_keyset_pagination_and_read_transaction(self):
        event=self.event();event['queryStringParameters']['limit']='1'
        conn=MagicMock();conn.run.side_effect=[[],[[[{'id':ACTOR},{'id':TENANT}]]]]
        with patch.object(parties,'application_connection') as connect, patch.object(parties,'_set_actor',return_value=ACTOR):
            connect.return_value.__enter__.return_value=conn
            response=self.call(event)
            self.assertEqual(response['statusCode'],200)
            self.assertEqual(json.loads(response['body'])['data'],{'items':[{'id':ACTOR}],'next_cursor':ACTOR})
            connect.assert_called_once_with(write=False)

    def test_database_errors_are_sanitized(self):
        event=self.event()
        with patch.object(parties,'application_connection') as connect:
            connect.side_effect=RuntimeError({'C':'40001','M':'sensitive sentinel'})
            response=self.call(event)
            self.assertEqual(response['statusCode'],409)
            self.assertNotIn('sensitive sentinel',response['body'])


if __name__ == '__main__':
    unittest.main()
