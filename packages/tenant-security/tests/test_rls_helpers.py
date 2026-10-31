from tenant_security.http import api_response


def test_api_response_shape():
    resp = api_response(200, {"ok": True})
    assert resp["statusCode"] == 200
    assert "application/json" in resp["headers"]["Content-Type"]
