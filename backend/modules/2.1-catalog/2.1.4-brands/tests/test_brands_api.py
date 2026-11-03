import unittest
from unittest.mock import Mock
from brands_api.handler import HttpError,_request
class T(unittest.TestCase):
 def test_list(self):r=Mock();r.list.return_value=[];self.assertEqual(_request({'requestContext':{'http':{'method':'GET'}}},r),(200,{'items':[]}))
 def test_create_key(self):
  with self.assertRaises(HttpError):_request({'requestContext':{'http':{'method':'POST'}},'body':'{"slug":"acme","name":"ACME"}'},Mock())
