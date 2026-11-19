import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from unittest.mock import patch

from ecommerce_api.handler import HttpError, _checkout, _claim, _customer_portal, _declared_exchange_rate, _request, _validate_payment_configuration, _verified_profile, lambda_handler


class EcommerceApiTest(unittest.TestCase):
    NODE_ID = "00000000-0000-0000-0000-000000000010"

    def test_missing_identity_is_rejected_before_tenant_parsing(self):
        event = {"requestContext": {"http": {"method": "GET", "path": "/v1/companies/x/stores"}}}
        with patch.dict("sys.modules", {"tenant_security.db": SimpleNamespace(db_connection=None)}):
            self.assertEqual(lambda_handler(event, None)["statusCode"], 401)

    def test_public_catalog_uses_host(self):
        repository = Mock()
        repository.public_catalog.return_value = {"products": []}
        event = {"headers": {"host": "shop.example.test"}, "requestContext": {"http": {"method": "GET"}}}
        self.assertEqual(_request(event, repository, public=True), (200, {"products": []}))
        repository.public_catalog.assert_called_once_with("shop.example.test", 100, None)

    def test_create_requires_store_identity(self):
        event = {"requestContext": {"http": {"method": "POST"}}, "pathParameters": {"company_id": "00000000-0000-0000-0000-000000000001"}, "body": "{}"}
        with self.assertRaises(HttpError):
            _request(event, Mock())

    def test_payment_configuration_requires_valid_backend_recipients(self):
        valid = {"configuration": {"payments": {"pago-movil": True}, "paymentDetails": {
            "mobilePayment": {"document": "V12345678", "phone": "04121234567", "bankCode": "0102"},
            "bankTransfer": None}}}
        self.assertIsNone(_validate_payment_configuration(valid))
        invalid = {"configuration": {"payments": {"pago-movil": True}, "paymentDetails": {
            "mobilePayment": {"document": "invalid", "phone": "123", "bankCode": "1"}}}}
        with self.assertRaises(HttpError):
            _validate_payment_configuration(invalid)

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

    @patch("ecommerce_api.handler._verified_profile")
    def test_checkout_forwards_only_validated_payload_and_identity(self, verify):
        claims = {"iss": "issuer", "sub": "subject"}
        verify.return_value = claims
        repository = Mock()
        repository.checkout.return_value = {"id": "order-1"}
        event = {"headers": {"Idempotency-Key": "checkout-1"}, "body": (
            '{"domain":"shop.example.invalid","node_id":"00000000-0000-0000-0000-000000000010","items":[{"product_id":"p","quantity":1}],'
            '"delivery":{"address":"QA Street","latitude":10.48,"longitude":-66.9},"delivery_method":"realtime","payment_method":"cash"}')}
        self.assertEqual(_checkout(event, repository, claims), (201, {"id": "order-1"}))
        repository.checkout.assert_called_once_with(claims, unittest.mock.ANY, "checkout-1")

    def test_checkout_requires_idempotency_key(self):
        event = {"body": '{"domain":"shop","items":[{}],"delivery":{},'
                         '"delivery_method":"realtime","payment_method":"cash"}'}
        with self.assertRaises(HttpError):
            _checkout(event, Mock(), {})

    def test_checkout_rejects_delivery_without_coordinates(self):
        event = {"headers": {"Idempotency-Key": "checkout-location"}, "body": (
            '{"domain":"shop","node_id":"00000000-0000-0000-0000-000000000010","items":[{}],"delivery":{"address":"QA Street"},'
            '"delivery_method":"realtime","payment_method":"cash"}')}
        with self.assertRaises(HttpError) as raised:
            _checkout(event, Mock(), {})
        self.assertEqual(raised.exception.code, "invalid_delivery_address")

    @patch("ecommerce_api.handler._verified_profile")
    @patch("ecommerce_api.handler.current_rate", return_value={"rate":"914.0218","source":"bcv.today","effectiveDate":"2026-11-16"})
    def test_checkout_accepts_tenant_bank_payment_reference(self, _rate, verify):
        claims = {"iss": "issuer", "sub": "subject"}
        verify.return_value = claims
        repository = Mock()
        repository.checkout.return_value = {"id": "order-1"}
        event = {"headers": {"Idempotency-Key": "checkout-mobile"}, "body": (
            '{"domain":"shop.example.invalid","node_id":"00000000-0000-0000-0000-000000000010","items":[{"product_id":"p","quantity":1}],'
            '"delivery":{"address":"QA Street","latitude":10.48,"longitude":-66.9},"delivery_method":"realtime",'
            '"payment_method":"mobile","payment_reference":"12345678"}')}
        self.assertEqual(_checkout(event, repository, claims)[0], 201)

    def test_recent_declared_bcv_rate_is_strictly_validated(self):
        today = datetime.now(timezone.utc).date().isoformat()
        self.assertEqual(_declared_exchange_rate({"rate": 916.6477, "source": "bcv.today", "effectiveDate": today}),
                         {"rate": "916.6477", "source": "bcv.today", "effectiveDate": today})
        self.assertIsNone(_declared_exchange_rate({"rate": 916.6477, "source": "other", "effectiveDate": today}))
        self.assertIsNone(_declared_exchange_rate({"rate": -1, "source": "bcv.today", "effectiveDate": today}))

    @patch("ecommerce_api.handler._verified_profile")
    @patch("ecommerce_api.handler.current_rate", return_value=None)
    def test_paid_reference_is_not_blocked_when_bcv_provider_is_unavailable(self, _rate, verify):
        claims = {"iss": "issuer", "sub": "subject"}
        verify.return_value = claims
        repository = Mock()
        repository.checkout.return_value = {"id": "order-1"}
        event = {"headers": {"Idempotency-Key": "checkout-bcv-outage"}, "body": (
            '{"domain":"shop.example.invalid","node_id":"00000000-0000-0000-0000-000000000010",'
            '"items":[{"product_id":"p","quantity":1}],"delivery":{"address":"QA Street","latitude":10.48,"longitude":-66.9},'
            '"delivery_method":"realtime","payment_method":"mobile","payment_reference":"12345678",'
            '"payer":{"bankCode":"0102","document":"V12345678","phone":"04121234567"}}')}
        self.assertEqual(_checkout(event, repository, claims), (201, {"id": "order-1"}))
        self.assertIsNone(repository.checkout.call_args.args[1]["_exchange_rate"])

    @patch("ecommerce_api.handler._verified_profile")
    @patch("ecommerce_api.handler.current_rate", return_value={"rate":"914.0218","source":"bcv.today","effectiveDate":"2026-11-16"})
    def test_checkout_remembers_validated_payer_after_order(self, _rate, verify):
        claims = {"iss": "issuer", "sub": "subject"}
        verify.return_value = claims
        repository = Mock()
        repository.checkout.return_value = {"id": "order-1"}
        event = {"headers": {"Idempotency-Key": "checkout-payer"}, "body": (
            '{"domain":"shop.example.invalid","node_id":"00000000-0000-0000-0000-000000000010","items":[{"product_id":"p","quantity":1}],'
            '"delivery":{"address":"QA Street","latitude":10.48,"longitude":-66.9},"delivery_method":"realtime","payment_method":"mobile",'
            '"payment_reference":"12345678","payer":{"bankCode":"0102","document":"V12345678","phone":"04121234567"}}')}
        self.assertEqual(_checkout(event, repository, claims), (201, {"id": "order-1"}))
        repository.save_payment_method.assert_called_once_with(
            claims, "shop.example.invalid", "mobile",
            {"bankCode": "0102", "document": "V12345678", "phone": "04121234567", "holder": None})

    def test_checkout_rejects_invalid_payer_before_creating_order(self):
        repository = Mock()
        event = {"headers": {"Idempotency-Key": "checkout-payer"}, "body": (
            '{"domain":"shop.example.invalid","node_id":"00000000-0000-0000-0000-000000000010","items":[{}],"delivery":{"address":"QA Street","latitude":10.48,"longitude":-66.9},'
            '"delivery_method":"realtime","payment_method":"mobile","payment_reference":"12345678",'
            '"payer":{"bankCode":"0102","document":"V12345678"}}')}
        with self.assertRaises(HttpError):
            _checkout(event, repository, {})
        repository.checkout.assert_not_called()

    @patch("ecommerce_api.handler._verified_profile")
    def test_cash_checkout_ignores_payer(self, verify):
        verify.return_value = {"iss": "issuer", "sub": "subject"}
        repository = Mock()
        repository.checkout.return_value = {"id": "order-1"}
        event = {"headers": {"Idempotency-Key": "checkout-cash"}, "body": (
            '{"domain":"shop.example.invalid","node_id":"00000000-0000-0000-0000-000000000010","items":[{}],"delivery":{"address":"QA Street","latitude":10.48,"longitude":-66.9},'
            '"delivery_method":"realtime","payment_method":"cash","payer":{"bankCode":"x"}}')}
        self.assertEqual(_checkout(event, repository, {})[0], 201)
        repository.save_payment_method.assert_not_called()

    @patch("ecommerce_api.handler._verified_profile")
    def test_customer_payment_methods_are_scoped_to_identity_and_domain(self, verify):
        claims = {"iss": "issuer", "sub": "subject"}
        verify.return_value = claims
        repository = Mock()
        repository.payment_methods.return_value = []
        event = {"requestContext": {"http": {"method": "GET"}},
                 "queryStringParameters": {"domain": "shop.example.invalid"}}
        self.assertEqual(_customer_portal(event, repository, claims, "/v1/storefront/me/payment-methods"),
                         (200, {"items": []}))
        repository.payment_methods.assert_called_once_with(claims, "shop.example.invalid")

    def test_payment_configuration_validates_pos_and_custom_methods(self):
        valid = {"configuration": {"payments": {"punto-venta-entrega": True, "punto-venta-retiro": False},
                 "paymentDetails": {"customMethods": [
                     {"id": "zelle", "name": "Zelle", "instructions": "Envía a pagos@example.invalid", "enabled": True}]}}}
        self.assertIsNone(_validate_payment_configuration(valid))
        for methods in ([{"id": "Zelle!", "name": "Zelle", "instructions": "x", "enabled": True}],
                        [{"id": "a", "name": "A", "instructions": "x", "enabled": True}],
                        [{"id": "a", "name": "Aa", "instructions": "x", "enabled": True},
                         {"id": "a", "name": "Bb", "instructions": "y", "enabled": True}],
                        [{"id": "a", "name": "Aa", "instructions": "x", "enabled": "yes"}]):
            with self.assertRaises(HttpError):
                _validate_payment_configuration({"configuration": {"paymentDetails": {"customMethods": methods}}})
        with self.assertRaises(HttpError):
            _validate_payment_configuration({"configuration": {"payments": {"punto-venta-entrega": "true"}}})

    @patch("ecommerce_api.handler._verified_profile")
    def test_checkout_forwards_pos_and_custom_methods(self, verify):
        claims = {"iss": "issuer", "sub": "subject"}
        verify.return_value = claims
        repository = Mock()
        repository.checkout.return_value = {"id": "order-1"}
        base = ('{"domain":"shop.example.invalid","node_id":"00000000-0000-0000-0000-000000000010","items":[{"product_id":"p","quantity":1}],'
                '"delivery":{"address":"QA Street","latitude":10.48,"longitude":-66.9},"delivery_method":"realtime",')
        pos = {"headers": {"Idempotency-Key": "checkout-pos"}, "body": base + '"payment_method":"pos"}'}
        self.assertEqual(_checkout(pos, repository, claims)[0], 201)
        custom = {"headers": {"Idempotency-Key": "checkout-custom"}, "body": base + (
            '"payment_method":"custom","payment_method_id":"zelle","payment_reference":"778899",'
            '"payer":{"bankCode":"0102","document":"V12345678"}}')}
        self.assertEqual(_checkout(custom, repository, claims)[0], 201)
        repository.save_payment_method.assert_not_called()
        for body in ('"payment_method":"custom","payment_reference":"778899"}',
                     '"payment_method":"custom","payment_method_id":"zelle"}'):
            with self.assertRaises(HttpError):
                _checkout({"headers": {"Idempotency-Key": "bad"}, "body": base + body}, repository, claims)

    def test_custom_checkout_sends_method_id_to_database(self):
        from ecommerce_api.repository import EcommerceRepository
        connection = Mock()
        connection.execute.return_value.fetchone.return_value = {"value": {"id": "order-1"}}
        EcommerceRepository(connection).checkout({"iss": "issuer", "sub": "subject"}, {
            "domain": "shop", "node_id": self.NODE_ID, "items": [], "delivery": {}, "delivery_method": "realtime",
            "payment_method": "custom", "payment_method_id": "zelle", "payment_reference": "778899"}, "key")
        self.assertEqual(connection.execute.call_args.args[1][6],
                         {"method": "custom", "reference": "778899", "methodId": "zelle"})

    def test_bank_checkout_persists_exchange_evidence_for_finance(self):
        from ecommerce_api.repository import EcommerceRepository
        connection = Mock()
        connection.execute.return_value.fetchone.return_value = {"value": {"id": "order-1", "total": "112.00"}}
        EcommerceRepository(connection).checkout({"iss": "issuer", "sub": "subject"}, {
            "domain": "shop", "node_id": self.NODE_ID, "items": [], "delivery": {}, "delivery_method": "realtime",
            "payment_method": "mobile", "payment_reference": "54646546",
            "_payer": {"bankCode": "0102", "document": "V12345678", "phone": "04121234567"},
            "_exchange_rate": {"rate": "914.0218", "source": "BCV", "effectiveDate": "2026-11-16"},
        }, "key")
        declaration = connection.execute.call_args_list[1].args[1][1]
        self.assertEqual(declaration["exchangeRate"], "914.0218")
        self.assertEqual(declaration["exchangeRateEffectiveDate"], "2026-11-16")
        self.assertEqual(declaration["exchangeRateSource"], "BCV")
        self.assertEqual(declaration["amountVES"], "102370.44")

    def test_checkout_rejects_bank_payment_without_reference(self):
        event = {"headers": {"Idempotency-Key": "checkout-mobile"}, "body": (
            '{"domain":"shop.example.invalid","node_id":"00000000-0000-0000-0000-000000000010","items":[{}],"delivery":{"address":"QA Street","latitude":10.48,"longitude":-66.9},'
            '"delivery_method":"realtime","payment_method":"mobile"}')}
        with self.assertRaises(HttpError):
            _checkout(event, Mock(), {})

    @patch("ecommerce_api.handler._verified_profile")
    def test_customer_orders_are_derived_from_identity_and_domain(self, verify):
        claims = {"iss": "issuer", "sub": "subject"}
        verify.return_value = claims
        repository = Mock()
        repository.customer_read.return_value = []
        event = {"requestContext": {"http": {"method": "GET"}},
                 "queryStringParameters": {"domain": "shop.example.invalid"}}
        self.assertEqual(_customer_portal(event, repository, claims, "/v1/storefront/orders"),
                         (200, {"items": []}))
        repository.customer_read.assert_called_once_with(
            claims, "shop.example.invalid", "orders", limit=25)

    def test_address_coordinates_are_cast_to_numeric(self):
        from ecommerce_api.repository import EcommerceRepository
        connection = Mock()
        connection.execute.return_value.fetchone.return_value = {"value": {"id": "a", "version": 1}}
        EcommerceRepository(connection).save_address(
            {"iss": "issuer", "sub": "subject"}, "shop.example.invalid",
            {"label": "Casa", "address": "Calle 1", "zone": "Centro", "latitude": 10.48, "longitude": -66.9})
        self.assertIn("%s::numeric,%s::numeric", connection.execute.call_args.args[0])

    @patch("ecommerce_api.handler._verified_profile")
    def test_customer_portal_requires_store_domain(self, verify):
        verify.return_value = {"iss": "issuer", "sub": "subject"}
        with self.assertRaises(HttpError):
            _customer_portal({"requestContext": {"http": {"method": "GET"}}}, Mock(), {},
                             "/v1/storefront/me")

    @patch.dict("os.environ", {"COGNITO_ISSUER": "https://issuer.invalid", "STOREFRONT_COGNITO_CLIENT_ID": "store-client"})
    def test_profile_requires_storefront_id_token_claims(self):
        valid = {"iss": "https://issuer.invalid", "sub": "customer", "aud": "store-client",
                 "token_use": "id", "email": "customer@example.invalid", "email_verified": "true"}
        self.assertEqual(_verified_profile(valid), valid)
        for field, value in (("aud", "admin-client"), ("token_use", "access"), ("email_verified", "false")):
            rejected = {**valid, field: value}
            with self.assertRaises(HttpError):
                _verified_profile(rejected)
