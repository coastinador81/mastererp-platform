"""Real Cognito code+PKCE and DEV API QA; never emit credentials or tokens."""
import base64
import hashlib
import http.cookiejar
import json
import logging
import pathlib
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from html.parser import HTMLParser

import boto3

logging.disable(logging.CRITICAL)
ORIGIN = "https://app-dev.uonify.com"
CALLBACK = ORIGIN + "/auth/callback"
DOMAIN = "https://mastererp-dev-uonify-277352717693.auth.us-west-1.amazoncognito.com"
CLIENT = "56psiha6rtmsu8qklace85k8m0"
API = "https://ebn01q74hh.execute-api.us-west-1.amazonaws.com"
STATUS = "/v1/uonify/google/connection/status"
SPACES = "/v1/uonify/spaces"
SCOPES = "openid email mastererp-dev/uonify.connections.status mastererp-dev/identity.spaces.read"


class CallbackReached(Exception):
    pass


class Redirect(urllib.request.HTTPRedirectHandler):
    callback = None

    def redirect_request(self, request, fp, code, message, headers, new_url):
        if new_url.startswith(CALLBACK + "?"):
            self.callback = new_url
            raise CallbackReached()
        return super().redirect_request(request, fp, code, message, headers, new_url)


class LoginForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.forms = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form":
            self.current = {"action": attrs.get("action", ""), "fields": {}}
            self.forms.append(self.current)
        if tag == "input" and self.current is not None and attrs.get("name"):
            self.current["fields"][attrs["name"]] = attrs.get("value", "")

    def handle_endtag(self, tag):
        if tag == "form":
            self.current = None


def tokens(actor, scopes=SCOPES):
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    state = secrets.token_urlsafe(32)
    query = urllib.parse.urlencode({"client_id": CLIENT, "response_type": "code", "redirect_uri": CALLBACK,
        "scope": scopes, "state": state, "code_challenge": challenge, "code_challenge_method": "S256"})
    redirect = Redirect()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()), redirect)
    try:
        response = opener.open(DOMAIN + "/oauth2/authorize?" + query, timeout=30)
    except CallbackReached:
        response = None
    if response is not None:
        parser = LoginForm()
        parser.feed(response.read().decode())
        form = next((f for f in parser.forms if "password" in f["fields"]), None)
        if not form:
            raise RuntimeError("managed_login_form_unavailable")
        form["fields"].update({"username": actor["email"], "password": actor["password"]})
        request = urllib.request.Request(urllib.parse.urljoin(response.url, form["action"]),
            data=urllib.parse.urlencode(form["fields"]).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            opener.open(request, timeout=30)
        except CallbackReached:
            pass
    if not redirect.callback:
        raise RuntimeError("managed_login_did_not_complete")
    result = urllib.parse.parse_qs(urllib.parse.urlparse(redirect.callback).query)
    if result.get("state") != [state] or "code" not in result:
        raise RuntimeError("oauth_state_validation_failed")
    request = urllib.request.Request(DOMAIN + "/oauth2/token", data=urllib.parse.urlencode({
        "grant_type": "authorization_code", "client_id": CLIENT, "redirect_uri": CALLBACK,
        "code": result["code"][0], "code_verifier": verifier}).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    with opener.open(request, timeout=30) as response:
        return json.load(response)


def api(path, token=None, tenant=None, method="GET", origin=ORIGIN):
    headers = {"Origin": origin}
    if token:
        headers["Authorization"] = "Bearer " + token
    if tenant:
        headers["X-MasterERP-Tenant-Id"] = tenant
    if method == "OPTIONS":
        headers.update({"Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,x-mastererp-tenant-id"})
    request = urllib.request.Request(API + path, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read()
    try:
        body = json.loads(raw) if raw else {}
    except ValueError:
        body = {}
    return response.code, {k.lower(): v for k, v in response.headers.items()}, body
