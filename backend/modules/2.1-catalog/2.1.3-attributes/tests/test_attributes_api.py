import json,unittest
from unittest.mock import Mock
from attributes_api.handler import HttpError,_request
def event(method='GET',code=None,body=None):return {'requestContext':{'http':{'method':method}},'pathParameters':{'attribute_code':code} if code else {},'body':json.dumps(body or {}),'headers':{}}
class TestAttributes(unittest.TestCase):
 def test_list(self):r=Mock();r.list.return_value=[];self.assertEqual(_request(event(),r),(200,{'items':[]}))
 def test_create_requires_key(self):
  with self.assertRaises(HttpError):_request(event('POST',body={'code':'color','name':'Color','type':'SELECT'}),Mock())
 def test_update_requires_change(self):
  with self.assertRaises(HttpError):_request(event('PATCH','color',{'version':1}),Mock())
if __name__=='__main__':unittest.main()
