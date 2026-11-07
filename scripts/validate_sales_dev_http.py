"""Real DEV Orders -> Sales HTTP acceptance. No credentials or tokens in reports."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import urllib.error
import urllib.request
from uuid import uuid4
import boto3
from botocore.config import Config
import identity_qa_client as qa


API = "https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    session = boto3.Session(profile_name="mastererp-admin", region_name="us-west-1")
    assert session.client("sts").get_caller_identity()["Account"] == "277352717693"
    bundle = json.loads(session.client("secretsmanager").get_secret_value(
        SecretId="mastererp/dev/qa/identity-validation")["SecretString"])
    tokens = {name: qa.tokens(bundle["actors"][name])["access_token"] for name in ("admin_a", "admin_b")}
    client = session.client("lambda", config=Config(read_timeout=310, retries={"max_attempts": 0}))
    run = "qa-sales-http-" + uuid4().hex[:12]
    report = {"run": run, "environment": "AWS DEV us-west-1", "results": []}
    prepared = False

    def save():
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    def fixture(operation):
        response = client.invoke(FunctionName="mastererp-dev-database-migrator", Payload=json.dumps({
            "action": "sales_http_fixture", "operation": operation, "run": run,
            "identity_run": bundle["run"]}).encode())
        value = json.load(response["Payload"])
        if response.get("FunctionError") or value.get("status") != "succeeded":
            raise RuntimeError("Sales fixture failed: " + operation)
        return value

    def request(path, method="GET", payload=None, actor="admin_a", key=None, tenant=None, base=API):
        headers = {"Origin": qa.ORIGIN}
        if actor:
            headers["Authorization"] = "Bearer " + tokens[actor]
        if tenant:
            headers["X-Tenant-Id"] = tenant
        if key:
            headers["Idempotency-Key"] = key
        if payload is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(base + path, method=method, headers=headers,
              data=json.dumps(payload).encode() if payload is not None else None)
        try:
            response = urllib.request.urlopen(req, timeout=40)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read()
        return response.status, json.loads(raw) if raw else {}

    def check(name, status, expected):
        report["results"].append({"case": name, "http": status, "expected": expected,
                                  "result": "passed" if status == expected else "failed"})
        save()
        assert status == expected, name + ": unexpected HTTP " + str(status)

    try:
        state = fixture("prepare")
        prepared = True
        tenant, company, orders = state["tenant"], state["company"], state["orders"]
        report["fixture"] = {"tenant": tenant, "company": company, "orders": orders}
        path = f"/v1/companies/{company}/orders/{orders[0]}"
        body = {"version": 1, "status": "CONFIRMED", "reason": "QA_SALES_HTTP", "detail": "Identified DEV fixture"}
        check("missing_token", request(path, actor=None, tenant=tenant)[0], 401)
        check("foreign_actor", request(path, actor="admin_b", tenant=tenant)[0], 403)
        status, result = request(path + "/transitions", "POST", body, key=run + "-first", tenant=tenant)
        check("confirmation_persisted", status, 200)
        value = result.get("data", result)
        sale = value["sale"]["id"]
        check("order_detail_persisted", request(path, tenant=tenant)[0], 200)
        status, replay = request(path + "/transitions", "POST", body, key=run + "-first", tenant=tenant)
        check("idempotent_replay", status, 200)
        assert replay.get("data", replay)["sale"]["id"] == sale
        check("reason_content_conflict", request(path + "/transitions", "POST", dict(body, reason="QA_DIFFERENT"), key=run + "-first", tenant=tenant)[0], 409)
        check("stale_version", request(path + "/transitions", "POST", body, key=run + "-stale", tenant=tenant)[0], 409)
        for operation in ("deny", "module_disabled", "membership_inactive"):
            fixture(operation)
            try:
                check(operation, request(path + "/transitions", "POST", body, key=run + "-first", tenant=tenant)[0], 403)
            finally:
                fixture("restore")
        concurrent = f"/v1/companies/{company}/orders/{orders[1]}/transitions"
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: request(concurrent, "POST", body, key=run + "-race", tenant=tenant), range(2)))
        for index, (status, _) in enumerate(outcomes):
            check("concurrent_same_key_" + str(index), status, 200)
        assert len({row.get("data", row)["sale"]["id"] for _, row in outcomes}) == 1
        concurrent = f"/v1/companies/{company}/orders/{orders[2]}/transitions"
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda i: request(concurrent, "POST", body, key=run + "-distinct-" + str(i), tenant=tenant), range(2)))
        assert sorted(status for status, _ in outcomes) == [200, 409]
        report["results"].append({"case": "concurrent_distinct_keys_single_sale", "http": sorted(status for status, _ in outcomes), "result": "passed"})
        state = fixture("inspect")
        assert len(state["sales"]) == 3 and all(row[3] == "10" and row[4] for row in state["sales"])
        report["persisted_evidence"] = state
        check("uonify_spaces_existing_session", request(qa.SPACES, base=qa.API)[0], 200)
        report["status"] = "passed"
    finally:
        if prepared:
            report["archive"] = fixture("archive")
        save()


if __name__ == "__main__":
    main()
