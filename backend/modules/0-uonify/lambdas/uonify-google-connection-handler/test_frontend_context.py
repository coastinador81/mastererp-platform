import json,os,unittest
from unittest.mock import patch
import handler
from tenant_security.identity_access import AccessError
class ContextTests(unittest.TestCase):
    def test_query_context_preserves_spaces(self):
        event={'routeKey':handler.SPACES_ROUTE,'queryStringParameters':{'tenant_id':'tenant'}}
        with patch.object(handler,'authenticated_identity',return_value=('issuer','subject')),patch.object(handler,'user_spaces',return_value=[]),patch.object(handler,'frontend_context',return_value={'tenant_id':'tenant'}) as query:
            result=handler._handle(event,'correlation')
        self.assertEqual(result['statusCode'],200)
        self.assertEqual(json.loads(result['body']),{'spaces':[],'context':{'tenant_id':'tenant'}})
        query.assert_called_once_with('issuer','subject','tenant')
    def test_foreign_context_is_denied(self):
        event={'routeKey':handler.SPACES_ROUTE,'queryStringParameters':{'tenant_id':'foreign'}}
        with patch.object(handler,'authenticated_identity',return_value=('issuer','subject')),patch.object(handler,'user_spaces',return_value=[]),patch.object(handler,'frontend_context',side_effect=AccessError(403,'tenant_context_denied')):
            self.assertEqual(handler._handle(event,'correlation')['statusCode'],403)
    def test_unknown_context_parameters_rejected(self):
        with patch.object(handler,'authenticated_identity',return_value=('issuer','subject')):
            self.assertEqual(handler._handle({'routeKey':handler.SPACES_ROUTE,'queryStringParameters':{'email':'unsafe'}},'correlation')['statusCode'],400)
