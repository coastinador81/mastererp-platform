import unittest
from types import SimpleNamespace
from unittest.mock import patch
from unittest.mock import Mock
from routes_api.handler import _failure,_request,lambda_handler
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
 def test_delivery_failures_keep_safe_specific_codes(self):
  self.assertEqual(_failure(Exception('Delivery outside allowed radius')),(409,'delivery_outside_radius'))
  self.assertEqual(_failure(Exception('Driver route is not active')),(409,'route_not_active'))
  self.assertEqual(_failure(Exception('Order is not on driver route')),(409,'order_not_on_route'))
  self.assertEqual(_failure(Exception('Valid GPS evidence required')),(400,'invalid_gps'))
