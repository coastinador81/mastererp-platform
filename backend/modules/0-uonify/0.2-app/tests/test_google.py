"""Tokens firmados para pruebas: se comprueba el verificador real de Google."""
from datetime import datetime, timedelta, timezone
from dataclasses import replace
from urllib.parse import parse_qs, urlsplit
import json
import time
import pytest
import requests
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from google.auth import crypt, jwt
from google.auth.exceptions import GoogleAuthError
from app.google import GoogleProvider


@pytest.fixture
def signed_token():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'test-only')])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(private.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1))
            .not_valid_after(now+timedelta(days=1)).sign(private, hashes.SHA256()))
    signer = crypt.RSASigner.from_string(private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                              serialization.NoEncryption()), key_id='test-key')
    def make(**overrides):
        claims = {'iss': 'https://accounts.google.com', 'aud': 'test-client', 'azp': 'test-client',
                  'iat': int(time.time()), 'exp': int(time.time())+300, 'nonce': 'test-nonce',
                  'sub': 'test-subject', 'email': 'qa@example.test', 'email_verified': True, 'name': 'QA'}
        return jwt.encode(signer, {**claims, **overrides}).decode()
    return make, cert.public_bytes(serialization.Encoding.PEM).decode()


def install_google(monkeypatch, token, certificate):
    class Http:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def close(self): pass
        def post(self, url, **kwargs):
            assert url == 'https://oauth2.googleapis.com/token'
            assert kwargs['data']['code_verifier'] == 'test-verifier'
            result = requests.Response(); result.status_code = 200
            result._content = json.dumps({'id_token': token}).encode()
            return result
        def request(self, method, url, **kwargs):
            assert method == 'GET' and url == 'https://www.googleapis.com/oauth2/v1/certs'
            assert kwargs['timeout'] == 10
            result = requests.Response(); result.status_code = 200
            result._content = json.dumps({'test-key': certificate}).encode()
            return result
    monkeypatch.setattr('app.google.requests.Session', Http)


def test_valid_signed_identity_and_limited_scopes(environment, signed_token, monkeypatch):
    config, _, _ = environment
    make, cert = signed_token
    install_google(monkeypatch, make(), cert)
    provider = GoogleProvider(config)
    identity = provider.identity('code', 'test-nonce', 'test-verifier')
    assert identity['sub'] == 'test-subject' and identity['email'] == 'qa@example.test'
    query = parse_qs(urlsplit(provider.authorization_url('state', 'nonce', 'verifier')).query)
    assert query['scope'] == ['openid email profile']
    assert query['code_challenge_method'] == ['S256']
    assert 'access_type' not in query  # No acceso offline ni refresh token para iniciar sesión.


@pytest.mark.parametrize('overrides', [
    {'aud': 'another-client'}, {'iss': 'https://evil.test'}, {'exp': 1}, {'nonce': 'wrong'},
    {'email_verified': False}, {'email_verified': 'true'}, {'sub': ''}, {'azp': 'another-client'},
])
def test_rejects_invalid_signed_claims(environment, signed_token, monkeypatch, overrides):
    config, _, _ = environment
    make, cert = signed_token
    install_google(monkeypatch, make(**overrides), cert)
    with pytest.raises((ValueError, GoogleAuthError)):
        GoogleProvider(config).identity('code', 'test-nonce', 'test-verifier')


def test_rejects_invalid_signature(environment, signed_token, monkeypatch):
    config, _, _ = environment
    make, cert = signed_token
    token = make().split('.')
    token[2] = 'AAAA'
    install_google(monkeypatch, '.'.join(token), cert)
    with pytest.raises((ValueError, GoogleAuthError)):
        GoogleProvider(config).identity('code', 'test-nonce', 'test-verifier')
