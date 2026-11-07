import json,unittest
from unittest.mock import Mock
from inventory_api.handler import HttpError,_request
C='10000000-0000-0000-0000-000000000001';N='20000000-0000-0000-0000-000000000001';P='30000000-0000-0000-0000-000000000001';R='40000000-0000-0000-0000-000000000001'
def event(method='GET',path='',params=None,body=None,key='key'):
    return {'requestContext':{'http':{'method':method,'path':path}},'pathParameters':{'company_id':C,**(params or {})},'headers':{'Idempotency-Key':key} if key else {},'body':json.dumps(body or {})}
class InventoryApiTests(unittest.TestCase):
    def test_list(self):
        repo=Mock();repo.list.return_value=[];self.assertEqual(_request(event(params={'node_id':N}),repo),(200,{'items':[]}))
    def test_set_stock_requires_reason(self):
        with self.assertRaises(HttpError):_request(event('PUT',f'/nodes/{N}/inventory/{P}/stock',{'node_id':N,'product_id':P},{'stock':2}),Mock())
    def test_reserve(self):
        repo=Mock();repo.reserve.return_value={'reservation_ref':R};self.assertEqual(_request(event('POST',f'/nodes/{N}/inventory/reservations',{'node_id':N},{'items':[{'product_id':P,'quantity':1}]}),repo)[0],201)
    def test_finalize_contract(self):
        with self.assertRaises(HttpError):_request(event('POST',f'/reservations/{R}/finalize',{'reservation_id':R},{}),Mock())
if __name__=='__main__':unittest.main()
