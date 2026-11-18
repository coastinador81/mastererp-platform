import json, unittest
from unittest.mock import Mock
from handler import HttpError, database_error, request

class PaymentReviewApiTests(unittest.TestCase):
    def test_lists_pending_reviews(self):
        connection=Mock(); connection.execute.return_value.fetchone.return_value={"value":[{"order_id":"o"}]}
        event={"requestContext":{"http":{"method":"GET","path":"/v1/administration/receipts/pending"}},"queryStringParameters":{"company_id":"10000000-0000-0000-0000-000000000001"}}
        self.assertEqual(request(event,connection),(200,{"items":[{"order_id":"o"}]}))
    def test_review_requires_idempotency_key(self):
        order="20000000-0000-0000-0000-000000000001"
        event={"requestContext":{"http":{"method":"POST","path":f"/v1/administration/receipts/{order}/review"}},"pathParameters":{"company_id":"10000000-0000-0000-0000-000000000001","order_id":order},"body":json.dumps({"version":1,"decision":"VALIDATED","reason":"Verified","evidence":{}})}
        with self.assertRaises(HttpError): request(event,Mock())
    def test_query_cancellation_is_sanitized_as_unavailable(self):
        error=Exception("sensitive");error.sqlstate="57014";error.diag=Mock(constraint_name=None)
        self.assertEqual(database_error(error,"correlation"),(503,"review_timeout"))
    def test_invalid_exchange_rate_is_not_internal_error(self):
        error=Exception("sensitive");error.sqlstate="22023";error.diag=Mock(constraint_name=None)
        self.assertEqual(database_error(error,"correlation"),(422,"invalid_exchange_rate"))
    def test_lists_refund_accounts(self):
        connection=Mock();connection.execute.return_value.fetchone.return_value={"value":[{"id":"account"}]}
        event={"requestContext":{"http":{"method":"GET","path":"/v1/companies/c/finance/refund-accounts"}},"pathParameters":{"company_id":"10000000-0000-0000-0000-000000000001"}}
        self.assertEqual(request(event,connection),(200,{"items":[{"id":"account"}]}))
    def test_refund_requires_idempotency_key(self):
        order="20000000-0000-0000-0000-000000000001"
        event={"requestContext":{"http":{"method":"POST","path":f"/v1/companies/c/finance/receipts/{order}/refund"}},"pathParameters":{"company_id":"10000000-0000-0000-0000-000000000001","order_id":order},"body":json.dumps({"account_id":"30000000-0000-0000-0000-000000000001","amount":"47.00","currency":"USD","date":"2026-11-18","method":"Pago móvil","reference":"REF-1","credit_note_id":"40000000-0000-0000-0000-000000000001"})}
        with self.assertRaises(HttpError):request(event,Mock())
if __name__=="__main__": unittest.main()
