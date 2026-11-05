import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from unittest.mock import patch

from ecommerce_api.handler import HttpError, _claim, _request, _verified_profile, lambda_handler


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

    @patch("ecommerce_api.handler.secrets.token_urlsafe", return_value="x" * 43)
    def test_admin_invitation_returns_raw_token_once(self, _token):
        repository = Mock()
        repository.create_invitation.return_value = {"invitation_id": "inv-1", "expires_at": "later"}
        event = {"requestContext": {"http": {"method": "POST"}}, "pathParameters": {
            "company_id": "00000000-0000-0000-0000-000000000001",
            "store_id": "00000000-0000-0000-0000-000000000002",
            "customer_id": "00000000-0000-0000-0000-000000000003"}, "body": "{}"}
        status, body = _request(event, repository)
        self.assertEqual(status, 201)
        self.assertEqual(body["token"], "x" * 43)
        self.assertEqual(repository.create_invitation.call_args.args[3],
                         "cc0b1c2c66f3bb9fd1a081c626ba1bef62f6f96441a43be15268523776ac26a1")

    @patch("ecommerce_api.handler._verified_profile")
    def test_claim_uses_verified_profile_and_invitation(self, verify):
        verify.return_value = {"iss": "issuer", "sub": "subject", "email": "a@example.invalid"}
        repository = Mock()
        repository.claim_identity.return_value = {"customer_id": "customer"}
        event = {"body": '{"invitation_token":"0123456789abcdef0123456789abcdef"}'}
        self.assertEqual(_claim(event, repository, {"sub": "subject"}),
                         (200, {"customer_id": "customer"}))
        repository.claim_identity.assert_called_once()

    def test_claim_rejects_missing_invitation_token(self):
        with self.assertRaises(HttpError):
            _claim({"body": '{}'}, Mock(), {})

    @patch.dict("os.environ", {"COGNITO_ISSUER": "https://issuer.invalid", "STOREFRONT_COGNITO_CLIENT_ID": "store-client"})
    def test_profile_requires_storefront_id_token_claims(self):
        valid = {"iss": "https://issuer.invalid", "sub": "customer", "aud": "store-client",
                 "token_use": "id", "email": "customer@example.invalid", "email_verified": "true"}
        self.assertEqual(_verified_profile(valid), valid)
        for field, value in (("aud", "admin-client"), ("token_use", "access"), ("email_verified", "false")):
            rejected = {**valid, field: value}
            with self.assertRaises(HttpError):
                _verified_profile(rejected)
