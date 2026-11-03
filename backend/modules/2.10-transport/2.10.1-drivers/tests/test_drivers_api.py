import json
import unittest
from unittest.mock import Mock

from drivers_api.handler import HttpError, _request

COMPANY = "10000000-0000-0000-0000-000000000001"
DRIVER = "20000000-0000-0000-0000-000000000001"
NODE = "30000000-0000-0000-0000-000000000001"


def event(method="GET", driver=None, node=None, body=None, path=""):
    params = {"company_id": COMPANY}
    if driver:
        params["driver_id"] = driver
    if node:
        params["node_id"] = node
    return {"requestContext": {"http": {"method": method, "path": path}},
            "pathParameters": params, "body": json.dumps(body or {}), "headers": {}}


class DriversApiTests(unittest.TestCase):
    def test_list(self):
        repository = Mock()
        repository.list.return_value = []
        self.assertEqual(_request(event(), repository), (200, {"items": []}))

    def test_create_requires_idempotency(self):
        with self.assertRaises(HttpError):
            _request(event("POST", body={"name": "Ana", "phone": "04140000000"}, path=f"/v1/companies/{COMPANY}/drivers"), Mock())

    def test_update_requires_version_and_change(self):
        with self.assertRaises(HttpError):
            _request(event("PATCH", DRIVER, body={"version": 1}), Mock())

    def test_assign_node(self):
        repository = Mock()
        repository.assign.return_value = {"id": DRIVER}
        result = _request(event("PUT", DRIVER, NODE, {"active": True}, f"/v1/companies/{COMPANY}/nodes/{NODE}/drivers/{DRIVER}"), repository)
        self.assertEqual(result[0], 200)
        repository.assign.assert_called_once_with(COMPANY, NODE, DRIVER, True)


if __name__ == "__main__":
    unittest.main()
