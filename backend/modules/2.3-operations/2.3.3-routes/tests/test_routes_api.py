import unittest
from unittest.mock import Mock
from routes_api.handler import _request
C='10000000-0000-0000-0000-000000000001'
class T(unittest.TestCase):
 def test_list(self):r=Mock();r.list.return_value=[];self.assertEqual(_request({'requestContext':{'http':{'method':'GET'}},'pathParameters':{'company_id':C}},r),(200,{'items':[]}))
