import json,unittest
from unittest.mock import Mock
from nodes_api.handler import HttpError,_request
COMPANY='10000000-0000-0000-0000-000000000001';NODE='20000000-0000-0000-0000-000000000001'
def event(method='GET',node=None,body=None,path=''):
    params={'company_id':COMPANY};
    if node:params['node_id']=node
    return {'requestContext':{'http':{'method':method,'path':path}},'pathParameters':params,'body':json.dumps(body or {})}
class NodesApiTests(unittest.TestCase):
    def test_list(self):
        repo=Mock();repo.list.return_value=[];self.assertEqual(_request(event(),repo),(200,{'items':[]}))
    def test_configure_existing_branch(self):
        repo=Mock();repo.configure.return_value={'id':NODE};self.assertEqual(_request(event('PUT',NODE,{'accepts_orders':True}),repo)[0],200)
    def test_transition_contract(self):
        with self.assertRaises(HttpError):_request(event('POST',NODE,{'status':'ACTIVE'},f'/v1/companies/{COMPANY}/nodes/{NODE}/transitions'),Mock())
if __name__=='__main__':unittest.main()
