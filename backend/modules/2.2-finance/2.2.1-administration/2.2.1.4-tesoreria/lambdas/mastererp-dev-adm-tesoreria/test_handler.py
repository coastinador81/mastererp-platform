import json, unittest
from unittest.mock import Mock
from handler import HttpError, request

class PaymentReviewApiTests(unittest.TestCase):
    def test_lists_pending_reviews(self):
        connection=Mock(); connection.execute.return_value.fetchone.return_value={"value":[{"order_id":"o"}]}
        event={"requestContext":{"http":{"method":"GET","path":"/v1/administration/receipts/pending"}},"queryStringParameters":{"company_id":"10000000-0000-0000-0000-000000000001"}}
        self.assertEqual(request(event,connection),(200,{"items":[{"order_id":"o"}]}))
    def test_review_requires_idempotency_key(self):
        order="20000000-0000-0000-0000-000000000001"
        event={"requestContext":{"http":{"method":"POST","path":f"/v1/administration/receipts/{order}/review"}},"pathParameters":{"company_id":"10000000-0000-0000-0000-000000000001","order_id":order},"body":json.dumps({"version":1,"decision":"VALIDATED","reason":"Verified","evidence":{}})}
        with self.assertRaises(HttpError): request(event,Mock())
if __name__=="__main__": unittest.main()
