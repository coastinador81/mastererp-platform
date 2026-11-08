"""Google OIDC: código de autorización, PKCE y validación con biblioteca oficial."""
import base64
import hashlib
import hmac
from urllib.parse import urlencode
import requests
from google.auth.transport.requests import Request
from google.oauth2.id_token import verify_oauth2_token


class TimedRequest(Request):
    def __call__(self, *args, **kwargs):
        kwargs['timeout'] = 10
        return super().__call__(*args, **kwargs)


class GoogleProvider:
    def __init__(self, settings):
        self.settings = settings

    def authorization_url(self, state, nonce, verifier):
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        return 'https://accounts.google.com/o/oauth2/v2/auth?' + urlencode({
            'client_id': self.settings.google_client_id,
            'redirect_uri': self.settings.callback,
            'response_type': 'code', 'scope': 'openid email profile',
            'state': state, 'nonce': nonce, 'code_challenge': challenge,
            'code_challenge_method': 'S256', 'prompt': 'select_account',
        })

    def identity(self, code, nonce, verifier):
        with requests.Session() as http:
            result = http.post('https://oauth2.googleapis.com/token', data={
                'code': code, 'client_id': self.settings.google_client_id,
                'client_secret': self.settings.google_client_secret,
                'redirect_uri': self.settings.callback, 'grant_type': 'authorization_code',
                'code_verifier': verifier,
            }, timeout=10)
            result.raise_for_status()
            token = result.json().get('id_token')
            if not isinstance(token, str):
                raise ValueError('Missing identity')
            claims = verify_oauth2_token(token, TimedRequest(session=http), self.settings.google_client_id)
        if not isinstance(claims.get('nonce'), str) or not hmac.compare_digest(claims['nonce'], nonce):
            raise ValueError('Invalid nonce')
        subject, email = claims.get('sub'), claims.get('email')
        if not isinstance(subject, str) or not subject or len(subject) > 255:
            raise ValueError('Invalid subject')
        if claims.get('email_verified') is not True or not isinstance(email, str) or '@' not in email or len(email) > 320:
            raise ValueError('Unverified email')
        if claims.get('azp', self.settings.google_client_id) != self.settings.google_client_id:
            raise ValueError('Invalid authorized party')
        return {'sub': subject, 'email': email, 'name': str(claims.get('name', ''))[:200]}
