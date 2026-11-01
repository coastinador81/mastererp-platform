import json
import re
from typing import Any


class HttpError(Exception):
    def __init__(self, status: int, message: str, *, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code or "error"


def api_response(status: int, body: dict[str, Any] | list[Any] | None = None) -> dict[str, Any]:
    payload = body if body is not None else {}
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(payload, default=str),
    }


def parse_body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64

        raw = base64.b64decode(raw).decode("utf-8")
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError as exc:
        raise HttpError(400, "Invalid JSON body") from exc
    if not isinstance(data, dict):
        raise HttpError(400, "Body must be a JSON object")
    return data


def parse_path_params(event: dict[str, Any]) -> dict[str, str]:
    return {k: str(v) for k, v in (event.get("pathParameters") or {}).items()}


def match_route(method: str, path: str, pattern: str) -> re.Match[str] | None:
    regex = "^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "$"
    if not path.startswith("/"):
        path = "/" + path
    match = re.match(regex, path)
    return match if match else None
