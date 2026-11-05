import unittest
from types import SimpleNamespace
from unittest.mock import patch
from unittest.mock import Mock
from brands_api.handler import HttpError,_request,lambda_handler
class T(unittest.TestCase):
 def test_missing_identity(self):
  with patch.dict('sys.modules',{'tenant_security.db':SimpleNamespace(db_connection=None)}):self.assertEqual(lambda_handler({'requestContext':{'http':{'method':'GET'}}},None)['statusCode'],401)
 def test_list(self):r=Mock();r.list.return_value=[];self.assertEqual(_request({'requestContext':{'http':{'method':'GET'}}},r),(200,{'items':[]}))
 def test_create_key(self):
  with self.assertRaises(HttpError):_request({'requestContext':{'http':{'method':'POST'}},'body':'{"slug":"acme","name":"ACME"}'},Mock())
