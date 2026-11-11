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
 def test_driver_route(self):
  r=Mock();r.driver_route.return_value={'driver_id':C,'route':None};e={'requestContext':{'http':{'method':'GET','path':'/v1/companies/x/driver-route'}},'pathParameters':{'company_id':C}}
  self.assertEqual(_request(e,r),(200,{'driver_id':C,'route':None}))
 def test_driver_delivery(self):
  r=Mock();r.deliver.return_value={'route_completed':True};e={'requestContext':{'http':{'method':'POST','path':'/v1/companies/x/routes/'+C+'/driver-deliveries/'+C}},'pathParameters':{'company_id':C,'route_id':C,'order_id':C},'body':'{"status":"DELIVERED","evidence":{"latitude":10,"longitude":-66,"accuracy_meters":10}}'}
  self.assertEqual(_request(e,r),(200,{'route_completed':True}))
 def test_storefront_driver_route(self):
  r=Mock();r.storefront_driver_route.return_value={'driver_id':C,'route':None};e={'requestContext':{'http':{'method':'GET','path':'/v1/storefront/driver-route'}},'queryStringParameters':{'domain':'shop.test'}}
  self.assertEqual(_request(e,r),(200,{'driver_id':C,'route':None}))
 def test_storefront_delivery(self):
  r=Mock();r.storefront_deliver.return_value={'route_completed':True};e={'requestContext':{'http':{'method':'POST','path':'/v1/storefront/routes/x/driver-deliveries/y'}},'pathParameters':{'route_id':C,'order_id':C},'queryStringParameters':{'domain':'shop.test'},'body':'{"status":"FAILED","evidence":{"reason":"Ausente"}}'}
  self.assertEqual(_request(e,r),(200,{'route_completed':True}))
