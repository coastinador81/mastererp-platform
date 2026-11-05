import unittest
from types import SimpleNamespace
from unittest.mock import patch
from unittest.mock import Mock
from routes_api.handler import _request,lambda_handler
C='10000000-0000-0000-0000-000000000001'
class T(unittest.TestCase):
 def test_missing_identity(self):
  with patch.dict('sys.modules',{'tenant_security.db':SimpleNamespace(db_connection=None)}):self.assertEqual(lambda_handler({'requestContext':{'http':{'method':'GET'}}},None)['statusCode'],401)
 def test_list(self):r=Mock();r.list.return_value=[];self.assertEqual(_request({'requestContext':{'http':{'method':'GET'}},'pathParameters':{'company_id':C}},r),(200,{'items':[]}))
