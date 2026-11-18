import json
import unittest
from unittest.mock import Mock

from products_api.handler import HttpError, _claims, _request, _sql_error


class ProductsApiTests(unittest.TestCase):
    def event(self, method="GET", product_id=None, body=None):
        params = {"product_id": product_id} if product_id else {}
        return {"requestContext": {"http": {"method": method}}, "pathParameters": params,
                "headers": {"Idempotency-Key": "product-key"}, "body": json.dumps(body or {})}

    def test_list_does_not_mix_inventory(self):
        repo = Mock(); repo.list.return_value = [{"id": "one"}]
        status, result = _request(self.event(), repo)
        self.assertEqual((status, result), (200, {"items": [{"id": "one"}]}))

    def test_create_requires_server_fields_and_idempotency(self):
        with self.assertRaises(HttpError):
            _request(self.event("POST", body={"name": "Product"}), Mock())

    def test_create(self):
        repo = Mock(); repo.create.return_value = {"id": "one"}
        self.assertEqual(_request(self.event("POST", body={"name": "Product", "price": 2}), repo), (201, {"id": "one"}))

    def test_duplicate_variant_skus_are_rejected(self):
        body = {"name": "Product", "price": 2, "attributes": {"_catalog": {"attribute_codes": ["color"], "variants": [
            {"key": "color:red", "values": {"color": "Red"}, "sku": "SAME"},
            {"key": "color:blue", "values": {"color": "Blue"}, "sku": "same"},
        ]}}}
        with self.assertRaises(HttpError):
            _request(self.event("POST", body=body), Mock())

    def test_update_requires_version(self):
        with self.assertRaises(HttpError):
            _request(self.event("PATCH", "20000000-0000-0000-0000-000000000001", {"name": "New"}), Mock())

    def test_image_upload_request_is_scoped_to_existing_product(self):
        repo = Mock(); media = Mock(); media.upload_request.return_value = {"id": "image"}
        event = self.event("POST", "20000000-0000-0000-0000-000000000001", {"filename": "a.jpg", "content_type": "image/jpeg", "size": 10})
        event["requestContext"]["http"]["path"] = "/v1/products/20000000-0000-0000-0000-000000000001/images/upload-request"
        self.assertEqual(_request(event, repo, media), (201, {"id": "image"}))
        repo.require_write.assert_called_once()
        repo.get.assert_called_once()

    def test_gateway_claims_fail_closed(self):
        with self.assertRaises(HttpError):
            _claims({})

    def test_stale_version_is_sanitized(self):
        error = RuntimeError("SQL secret"); error.sqlstate = "40001"
        mapped = _sql_error(error)
        self.assertEqual((mapped.status, mapped.code), (409, "stale_version"))
        self.assertNotIn("secret", mapped.message)


if __name__ == "__main__":
    unittest.main()
