import json
import unittest
from unittest.mock import Mock

from orders_api.handler import HttpError, _request, _sql_error, _verified_claims


class OrdersApiTests(unittest.TestCase):
    def event(self, method="GET", order_id=None, body=None, path="/v1/companies/c/orders"):
        params = {"company_id": "10000000-0000-0000-0000-000000000001"}
        if order_id:
            params["order_id"] = order_id
        return {"requestContext": {"http": {"method": method, "path": path}}, "pathParameters": params,
                "headers": {"Idempotency-Key": "key-1"}, "body": json.dumps(body or {})}

    def test_lists_orders(self):
        repo = Mock(); repo.list.return_value = [{"id": "one"}]
        status, result = _request(self.event(), repo)
        self.assertEqual((status, result), (200, {"items": [{"id": "one"}]}))

    def test_create_requires_inventory_reservation(self):
        with self.assertRaises(HttpError) as caught:
            _request(self.event("POST", body={}), Mock())
        self.assertEqual(caught.exception.status, 400)

    def test_creates_idempotently(self):
        payload = {key: {} for key in ("customer_snapshot", "delivery_snapshot", "payment_snapshot")}
        payload.update({"branch_id": "b", "customer_id": "c", "currency": "USD", "items": [{}],
                        "delivery_window_ref": "slot", "delivery_method": "realtime",
                        "inventory_reservation_ref": "reservation"})
        repo = Mock(); repo.create.return_value = {"id": "order"}
        status, result = _request(self.event("POST", body=payload), repo)
        self.assertEqual((status, result), (201, {"id": "order"}))
        repo.create.assert_called_once()

    def test_transition_requires_optimistic_version(self):
        order_id = "20000000-0000-0000-0000-000000000001"
        with self.assertRaises(HttpError):
            _request(self.event("POST", order_id, {"status": "CONFIRMED"}, f"/v1/companies/c/orders/{order_id}/transitions"), Mock())

    def test_creates_persistent_note_idempotently(self):
        order_id = "20000000-0000-0000-0000-000000000001"
        repo = Mock(); repo.add_note.return_value = {"id": "note", "note": "Llamar al llegar"}
        path = f"/v1/companies/c/orders/{order_id}/notes"
        status, result = _request(self.event("POST", order_id, {"note": "  Llamar al llegar  "}, path), repo)
        self.assertEqual((status, result), (201, {"id": "note", "note": "Llamar al llegar"}))
        repo.add_note.assert_called_once_with(
            "10000000-0000-0000-0000-000000000001", order_id, "  Llamar al llegar  ", "key-1"
        )

    def test_note_requires_content_and_idempotency_key(self):
        order_id = "20000000-0000-0000-0000-000000000001"
        event = self.event("POST", order_id, {"note": " "}, f"/v1/companies/c/orders/{order_id}/notes")
        event["headers"] = {}
        with self.assertRaises(HttpError) as caught:
            _request(event, Mock())
        self.assertEqual(caught.exception.status, 400)

    def test_maps_database_errors_without_leaking_details(self):
        error = RuntimeError("secret SQL detail")
        error.sqlstate = "40001"
        mapped = _sql_error(error)
        self.assertEqual((mapped.status, mapped.code), (409, "stale_version"))
        self.assertNotIn("secret", mapped.message)

    def test_requires_gateway_verified_claims(self):
        with self.assertRaises(HttpError) as caught:
            _verified_claims({"headers": {"Authorization": "Bearer untrusted"}})
        self.assertEqual(caught.exception.status, 401)

    def test_accepts_gateway_verified_claims(self):
        event = {"requestContext": {"authorizer": {"jwt": {"claims": {"iss": "issuer", "sub": "subject"}}}}}
        self.assertEqual(_verified_claims(event)["sub"], "subject")


if __name__ == "__main__":
    unittest.main()
