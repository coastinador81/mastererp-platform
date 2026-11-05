import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from unittest.mock import patch

from ecommerce_api.handler import HttpError, _request, lambda_handler


class EcommerceApiTest(unittest.TestCase):
    def test_missing_identity_is_rejected_before_tenant_parsing(self):
        event = {"requestContext": {"http": {"method": "GET", "path": "/v1/companies/x/stores"}}}
        with patch.dict("sys.modules", {"tenant_security.db": SimpleNamespace(db_connection=None)}):
            self.assertEqual(lambda_handler(event, None)["statusCode"], 401)

    def test_public_catalog_uses_host(self):
        repository = Mock()
        repository.public_catalog.return_value = {"products": []}
        event = {"headers": {"host": "shop.example.test"}, "requestContext": {"http": {"method": "GET"}}}
        self.assertEqual(_request(event, repository, public=True), (200, {"products": []}))
        repository.public_catalog.assert_called_once_with("shop.example.test", 100)

    def test_create_requires_store_identity(self):
        event = {"requestContext": {"http": {"method": "POST"}}, "pathParameters": {"company_id": "00000000-0000-0000-0000-000000000001"}, "body": "{}"}
        with self.assertRaises(HttpError):
            _request(event, Mock())
