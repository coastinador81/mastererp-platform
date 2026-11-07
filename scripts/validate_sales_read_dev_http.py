"""Read-only DEV sales acceptance; reuse and resuspend identified QA sale history."""
import argparse
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import boto3
from botocore.config import Config
import identity_qa_client as qa

API = "https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com"
PROXY = "https://finanzas-dev.uonify.com"
BASE = "/v1/administration/ventas"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--existing-fixture-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    previous = json.loads(args.existing_fixture_report.read_text(encoding="utf-8"))
    assert previous["status"] == "passed"
    session = boto3.Session(profile_name="mastererp-admin", region_name="us-west-1")
    assert session.client("sts").get_caller_identity()["Account"] == "277352717693"
    bundle = json.loads(session.client("secretsmanager").get_secret_value(
        SecretId="mastererp/dev/qa/identity-validation")["SecretString"])
    tokens = {name: qa.tokens(bundle["actors"][name])["access_token"] for name in ("admin_a", "admin_b")}
    client = session.client("lambda", config=Config(read_timeout=310, retries={"max_attempts": 0}))
    report = {"run": previous["run"], "environment": "AWS DEV us-west-1", "results": []}

    def save():
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    def fixture(operation):
        result = client.invoke(FunctionName="mastererp-dev-database-migrator", Payload=json.dumps({
            "action": "sales_http_fixture", "operation": operation, "run": previous["run"],
            "identity_run": bundle["run"]}).encode())
        value = json.load(result["Payload"])
        if result.get("FunctionError") or value.get("status") != "succeeded":
            raise RuntimeError("fixture_operation_failed:" + operation)
        return value

    def request(suffix="", *, actor="admin_a", company=None, tenant=None, base=API, **query):
        headers = {"Origin": qa.ORIGIN, "X-MasterERP-Tenant-Id": tenant or state["tenant"]}
        if actor:
            headers["Authorization"] = "Bearer " + tokens[actor]
        query["company_id"] = company or state["company"]
        req = urllib.request.Request(base + BASE + suffix + "?" + urllib.parse.urlencode(query), headers=headers)
        try:
            response = urllib.request.urlopen(req, timeout=40)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read()
        return response.status, json.loads(raw) if raw else {}

    def check(name, result, expected):
        status, body = result
        report["results"].append({"case": name, "http": status, "expected": expected,
                                  "result": "passed" if status == expected else "failed"})
        save()
        assert status == expected, name + ": unexpected HTTP " + str(status)
        return body.get("data", body)

    prepared = False
    try:
        state = fixture("prepare_read")
        prepared = True
        report["fixture"] = {key: state[key] for key in ("tenant", "company", "other_company", "foreign_tenant", "foreign_company")}
        check("missing_token", request(actor=None), 401)
        first = check("list_authenticated", request(limit=1), 200)
        ids, page = [first["items"][0]["id"]], first
        while page["next_cursor"]:
            page = check("cursor_page_" + str(len(ids) + 1), request(limit=1, after=page["next_cursor"]), 200)
            ids += [row["id"] for row in page["items"]]
            assert len(ids) <= 3
        assert len(ids) == len(set(ids)) == 3
        detail = check("detail_persisted", request("/" + ids[0]), 200)
        assert detail["lineas"] and isinstance(detail["total"], str)
        found = check("search_order", request(q=detail["pedido"]["numero"]), 200)
        assert any(row["id"] == ids[0] for row in found["items"])
        assert check("search_empty", request(q=previous["run"] + "-no-match"), 200)["items"] == []
        assert check("same_tenant_empty_company", request(company=state["other_company"]), 200)["items"] == []
        check("company_detail_isolation", request("/" + ids[0], company=state["other_company"]), 404)
        check("company_cursor_isolation", request(company=state["other_company"], after=ids[0]), 400)
        check("foreign_company", request(company=state["foreign_company"]), 403)
        check("foreign_tenant", request(tenant=state["foreign_tenant"], company=state["foreign_company"]), 403)
        check("foreign_actor", request(actor="admin_b"), 403)
        check("frontend_proxy_authenticated", request(base=PROXY), 200)
        check("frontend_proxy_no_token_after_authorized_read", request(base=PROXY, actor=None), 401)
        for operation in ("read_denied", "module_disabled", "membership_inactive"):
            fixture(operation)
            try:
                check(operation, request(), 403)
            finally:
                fixture("restore")
        check("restored_context_no_leak", request(), 200)
        check("existing_health", request("/health", actor=None), 200)
        inspected = fixture("inspect")
        for key in ("sales", "order_states", "audit_sales", "audit_orders"):
            assert inspected[key] == state[key], "Read changed existing financial history: " + key
        report["financial_history_unchanged"] = True
        report["status"] = "passed"
    finally:
        if prepared:
            report["archive"] = fixture("archive")
        save()


if __name__ == "__main__":
    main()
