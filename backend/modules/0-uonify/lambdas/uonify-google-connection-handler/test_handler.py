import importlib.util
import json
import os
import pathlib
import sys
import unittest
from unittest.mock import patch, MagicMock

folder = pathlib.Path(__file__).parent
sys.path.insert(0, str(folder.parents[3] / "shared/tenant-security"))
spec = importlib.util.spec_from_file_location("connection_handler", folder / "handler.py")
handler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(handler)
from tenant_security.identity_access import AccessError, connection_access


class HandlerTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"COGNITO_ISSUER": "https://test.invalid",
            "COGNITO_APP_CLIENT_ID": "test-client", "IDENTITY_DB_ENABLED": "false"})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def event(self, route=None):
        return {"routeKey": route or handler.ROUTE,
            "headers": {"X-MasterERP-Tenant-Id": "62000000-0000-0000-0000-000000000001"},
            "requestContext": {"authorizer": {"jwt": {"claims": {
                "sub": "test-subject", "iss": "https://test.invalid",
                "client_id": "test-client", "token_use": "access",
                "scope": "mastererp-dev/uonify.connections.status mastererp-dev/identity.spaces.read"}}}}}

    def invoke(self, event):
        return handler.lambda_handler(event, None)

    def test_missing_auth(self):
        self.assertEqual(self.invoke({"routeKey": handler.ROUTE})["statusCode"], 401)

    def test_browser_headers_do_not_authenticate(self):
        event = self.event()
        event["requestContext"] = {}
        event["headers"]["authorization"] = "Bearer fake"
        self.assertEqual(self.invoke(event)["statusCode"], 401)

    def test_id_token_rejected(self):
        event = self.event()
        event["requestContext"]["authorizer"]["jwt"]["claims"]["token_use"] = "id"
        self.assertEqual(self.invoke(event)["statusCode"], 401)

    def test_wrong_issuer_and_client(self):
        for key in ("iss", "client_id"):
            event = self.event()
            event["requestContext"]["authorizer"]["jwt"]["claims"][key] = "wrong"
            self.assertEqual(self.invoke(event)["statusCode"], 401)

    def test_api_scope_required(self):
        event = self.event()
        event["requestContext"]["authorizer"]["jwt"]["claims"]["scope"] = "openid"
        self.assertEqual(self.invoke(event)["statusCode"], 403)

    def test_closed_until_migration_and_credentials_ready(self):
        self.assertEqual(self.invoke(self.event())["statusCode"], 503)

    def test_tenant_denied(self):
        with patch.object(handler, "connection_access", side_effect=AccessError(403, "tenant_permission_denied")):
            self.assertEqual(self.invoke(self.event())["statusCode"], 403)

    def test_success_contract_with_test_double_only(self):
        with patch.object(handler, "connection_access", return_value=None) as check:
            result = self.invoke(self.event())
            self.assertEqual(result["statusCode"], 200)
            self.assertEqual(json.loads(result["body"]), {"provider": "google_cloud",
                "status": "not_configured", "oauthImplemented": False, "geminiEnabled": False})
            check.assert_called_once_with("https://test.invalid", "test-subject",
                "62000000-0000-0000-0000-000000000001")

    def test_missing_tenant(self):
        event = self.event()
        event["headers"] = {}
        self.assertEqual(self.invoke(event)["statusCode"], 403)

    def test_sanitized_errors(self):
        with patch.object(handler, "connection_access", side_effect=RuntimeError("sensitive")):
            with self.assertLogs("connection_handler", level="WARNING") as logs:
                result = self.invoke(self.event())
            self.assertNotIn("sensitive", result["body"] + str(logs.output))
            self.assertEqual(result["statusCode"], 503)

    def test_no_store_and_no_lambda_cors(self):
        result = self.invoke(self.event())
        self.assertEqual(result["headers"]["cache-control"], "no-store")
        self.assertFalse(any(k.startswith("access-control-") for k in result["headers"]))

    def test_spaces_use_real_shared_contract(self):
        with patch.object(handler, "user_spaces", side_effect=AccessError(403, "identity_not_linked")):
            result = self.invoke(self.event(handler.SPACES_ROUTE))
            self.assertEqual(json.loads(result["body"])["error"], "identity_not_linked")

    def test_connection_route_enforces_sql_module_guard(self):
        from tenant_security import identity_access
        connection=MagicMock()
        connection.run.side_effect=[[["71000000-0000-0000-0000-000000000001"]],None,None,[[False]]]
        with patch.object(identity_access,"application_connection") as database:
            database.return_value.__enter__.return_value=connection
            with self.assertRaises(AccessError) as failure:
                connection_access("https://test.invalid","subject","62000000-0000-0000-0000-000000000001")
        self.assertEqual(failure.exception.status,403)
        self.assertEqual(connection.run.call_args.kwargs['module'],'uonify.core')
        self.assertEqual(connection.run.call_args.kwargs['permission'],'uonify.connections.manage')

    def test_invalid_tenant_rejected_before_database(self):
        with self.assertRaises(AccessError) as failure:
            connection_access("https://test.invalid", "test-subject", "invalid-uuid")
        self.assertEqual(failure.exception.status, 400)


if __name__ == "__main__":
    unittest.main()
