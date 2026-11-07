import json,unittest
from unittest.mock import Mock
from categories_api.handler import HttpError,_request
def event(method='GET',slug=None,body=None):
 return {'requestContext':{'http':{'method':method}},'pathParameters':{'category_slug':slug} if slug else {},'body':json.dumps(body or {}),'headers':{}}
class CategoriesApiTests(unittest.TestCase):
 def test_list(self):repo=Mock();repo.list.return_value=[];self.assertEqual(_request(event(),repo),(200,{'items':[]}))
 def test_create_requires_key(self):
  with self.assertRaises(HttpError):_request(event('POST',body={'slug':'food','name':'Food'}),Mock())
 def test_update_requires_change(self):
  with self.assertRaises(HttpError):_request(event('PATCH','food',{'version':1}),Mock())
if __name__=='__main__':unittest.main()
