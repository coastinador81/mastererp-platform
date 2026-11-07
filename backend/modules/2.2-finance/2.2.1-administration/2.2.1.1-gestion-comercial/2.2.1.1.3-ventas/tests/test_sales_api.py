"""Unit doubles only; real RLS and persistence are validated in AWS DEV."""
from contextlib import contextmanager
import json
import unittest
from unittest.mock import patch, Mock
import handler as sales


UUID = "00004800-0000-0000-0000-000000000001"


class SalesApiTests(unittest.TestCase):
    def event(self, path="/v1/administration/ventas", **query):
        return {"rawPath": path, "requestContext": {"http": {"method": "GET"}},
                "headers": {"X-MasterERP-Tenant-Id": UUID},
                "queryStringParameters": {"company_id": UUID, **query}}

    def run_api(self, event, value=None, error=None):
        connection = Mock()
        def run(query, **values):
            if "ventas_leer" in query:
                if error:
                    raise error
                return [[value]]
            return [[None]]
        connection.run.side_effect = run
        @contextmanager
        def app(**kwargs):
            self.assertEqual(kwargs, {"write": False})
            yield connection
        with patch.object(sales, "authenticated_identity", return_value=("issuer", "subject")), \
             patch.object(sales, "application_connection", side_effect=app), \
             patch.object(sales, "_set_actor", return_value=UUID):
            response = sales.lambda_handler(event, None)
        return response, connection

    def test_preserves_technical_health(self):
        result = sales.lambda_handler(self.event("/v1/administration/ventas/health"), None)
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"])["lambda"], "mastererp-dev-adm-ventas")

    def test_list_has_server_cursor_and_read_only_connection(self):
        result, connection = self.run_api(self.event(limit="2"), [{"id": "first"}, {"id": "second"}, {"id": "third"}])
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(json.loads(result["body"])["data"], {"items": [{"id": "first"}, {"id": "second"}], "next_cursor": "second"})
        self.assertEqual(connection.run.call_args.kwargs["limit"], 3)
        self.assertEqual(connection.run.call_args.kwargs["company"], UUID)

    def test_detail_preserves_decimal_strings(self):
        result, _ = self.run_api(self.event("/v1/administration/ventas/" + UUID), {"id": UUID, "total": "9007199254740993.12"})
        self.assertEqual(json.loads(result["body"])["data"]["total"], "9007199254740993.12")

    def test_missing_identity_denied_before_connection(self):
        with patch.object(sales, "authenticated_identity", side_effect=sales.AccessError(401, "access_token_required")), \
             patch.object(sales, "application_connection") as app:
            self.assertEqual(sales.lambda_handler(self.event(), None)["statusCode"], 401)
            app.assert_not_called()

    def test_sql_denial_is_sanitized(self):
        result, _ = self.run_api(self.event(), error=RuntimeError({"C": "42501", "D": "private row data"}))
        self.assertEqual(result["statusCode"], 403)
        self.assertNotIn("private row data", result["body"])

    def test_invalid_limit_and_company_are_rejected(self):
        for query in ({"limit": "101"}, {"company_id": "not-uuid"}, {"q": "x" * 121}):
            result, connection = self.run_api(self.event(**query))
            self.assertEqual(result["statusCode"], 400)
            connection.run.assert_not_called()

    def test_mutations_not_exposed(self):
        event = self.event()
        event["requestContext"]["http"]["method"] = "POST"
        result, connection = self.run_api(event)
        self.assertEqual(result["statusCode"], 405)
        connection.run.assert_not_called()
