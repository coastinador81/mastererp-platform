"""Autorización Cloud separada de la identidad de Uonify. Ningún token llega a React."""
import base64
import hashlib
import hmac
import random
import re
import time
from urllib.parse import urlencode
import requests
from google.oauth2.id_token import verify_oauth2_token
from .google import TimedRequest

SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
PERMISSIONS = ['aiplatform.endpoints.predict', 'serviceusage.services.use']
# Official exponential backoff with jitter (google-drive-api.md §4.7), capped
# in TOTAL per request so an idempotent read still fits a spoken turn
# («Consultor google» Q3, 20-10-2026): about 0,5–1 s, then 1–1,5 s.
MAX_BACKOFF_SECONDS = 4.0


def retry_after(response):
    """Google's Retry-After in seconds, when it is a plain number."""
    try:
        value = float(response.headers.get('Retry-After'))
    except (AttributeError, TypeError, ValueError):
        return None
    return value if 0 <= value <= 3600 else None


class Backoff:
    """The waits of one request: their sum never exceeds MAX_BACKOFF_SECONDS."""

    def __init__(self):
        self.waited = 0.0

    def wait(self, attempt, response=None):
        """Sleep before retrying; False when the remaining budget cannot cover it.

        A Retry-After that fits is respected; one that does not ends the
        retries at once, so the caller reports the error without waiting.
        """
        remaining = MAX_BACKOFF_SECONDS - self.waited
        delay = retry_after(response) if response is not None else None
        if delay is None:
            delay = min(2 ** attempt * .5 + random.uniform(0, .5), remaining)
        if remaining <= 0 or delay > remaining:
            return False
        time.sleep(delay)
        self.waited += delay
        return True


def error_reason(response):
    """Google's error reason (`error.errors[0].reason`), or None."""
    try:
        reason = response.json()['error']['errors'][0]['reason']
    except (ValueError, KeyError, IndexError, TypeError):
        return None
    return reason if isinstance(reason, str) else None


class CloudError(Exception):
    def __init__(self, code='google_unavailable'):
        self.code = code


class GoogleCloudProvider:
    scopes = (SCOPE,)
    def __init__(self, settings):
        self.settings = settings

    def authorization_url(self, state, nonce, verifier, login_hint=None):
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
        return 'https://accounts.google.com/o/oauth2/v2/auth?' + urlencode({
            'client_id': self.settings.google_client_id, 'redirect_uri': self.settings.callback,
            'response_type': 'code', 'scope': 'openid email ' + ' '.join(self.scopes), 'access_type': 'offline',
            'prompt': 'consent', **({'login_hint': login_hint} if login_hint else {}), 'state': state, 'nonce': nonce,
            'code_challenge': challenge, 'code_challenge_method': 'S256',
        })

    def exchange(self, code, nonce, verifier):
        try:
            with requests.Session() as http:
                response = http.post('https://oauth2.googleapis.com/token', data={
                    'code': code, 'client_id': self.settings.google_client_id,
                    'client_secret': self.settings.google_client_secret, 'redirect_uri': self.settings.callback,
                    'grant_type': 'authorization_code', 'code_verifier': verifier}, timeout=10)
                response.raise_for_status()
                data = response.json()
                claims = verify_oauth2_token(data['id_token'], TimedRequest(session=http), self.settings.google_client_id)
            if (not isinstance(claims.get('nonce'), str) or not hmac.compare_digest(claims['nonce'], nonce) or
                    claims.get('email_verified') is not True or not claims.get('sub') or not claims.get('email') or
                    claims.get('azp', self.settings.google_client_id) != self.settings.google_client_id):
                raise ValueError()
            if not set(self.scopes) <= set(data.get('scope', '').split()):
                raise CloudError('permission_denied')
            if not data.get('refresh_token'):
                raise CloudError('reauthorize')
            return {'subject': claims['sub'], 'email': claims['email'], 'refresh': data['refresh_token'], 'scope': data['scope']}
        except CloudError:
            raise
        except (requests.RequestException, ValueError, KeyError):
            raise CloudError() from None

    def refresh(self, refresh_token):
        try:
            response = requests.post('https://oauth2.googleapis.com/token', data={
                'client_id': self.settings.google_client_id, 'client_secret': self.settings.google_client_secret,
                'refresh_token': refresh_token, 'grant_type': 'refresh_token'}, timeout=10)
            data = response.json()
            if data.get('error') == 'invalid_grant':
                raise CloudError('reauthorize')
            response.raise_for_status()
            return data['access_token']
        except CloudError:
            raise
        except (requests.RequestException, ValueError, KeyError):
            raise CloudError() from None

    def request(self, token, method, url, body=None, params=None):
        waits = Backoff()
        for attempt in range(self.max_retries + 1 if method == 'GET' else 1):
            try:
                response = requests.request(method, url, headers={'Authorization': 'Bearer ' + token},
                                            json=body, params=params, timeout=10)
            except requests.ConnectionError:
                if method == 'GET' and attempt < self.max_retries and waits.wait(attempt):
                    continue
                raise CloudError() from None
            except requests.RequestException:
                raise CloudError() from None
            if 200 <= response.status_code < 300:
                try:
                    return response.json()
                except ValueError:
                    raise CloudError() from None
            if (method == 'GET' and attempt < self.max_retries and self.retryable(response)
                    and waits.wait(attempt, response)):
                continue
            raise self.http_error(response)

    # Cloud APIs keep their contract: no retry and 403 means a permission
    # problem. The Drive provider refines both (ADK-FLUJOS audit F0.5).
    max_retries = 0

    def retryable(self, response):
        return False

    def http_error(self, response):
        if response.status_code == 401:
            return CloudError('reauthorize')
        if response.status_code == 403:
            return CloudError('permission_denied')
        return CloudError()

    def projects(self, token):
        projects, next_page = [], None
        for _ in range(20):
            data = self.request(token, 'GET', 'https://cloudresourcemanager.googleapis.com/v3/projects:search',
                                params={'query': 'state:ACTIVE', 'pageSize': 100, 'pageToken': next_page})
            projects.extend({'id': p['projectId'], 'name': p.get('displayName', p['projectId']), 'resource': p['name']}
                            for p in data.get('projects', []) if p.get('state') == 'ACTIVE')
            next_page = data.get('nextPageToken')
            if not next_page:
                return sorted(projects, key=lambda p: p['name'].lower())
        raise CloudError('too_many_projects')

    def billing_info(self, token, project_id):
        data = self.request(token, 'GET', f'https://cloudbilling.googleapis.com/v1/projects/{project_id}/billingInfo')
        name = data.get('billingAccountName') if isinstance(data, dict) else None
        if not isinstance(name, str) or not re.fullmatch(r'billingAccounts/[A-Za-z0-9-]+', name):
            raise CloudError('billing_not_linked')
        return {'name': name, 'enabled': data.get('billingEnabled') is True}

    def billing_account(self, token, name):
        if not re.fullmatch(r'billingAccounts/[A-Za-z0-9-]+', name):
            raise CloudError('invalid_response')
        data = self.request(token, 'GET', f'https://cloudbilling.googleapis.com/v1/{name}')
        if not isinstance(data, dict) or data.get('name') != name:
            raise CloudError('invalid_response')
        # The public account API identifies the account; it does not expose a
        # promotional balance. Currency and money require their own evidence.
        return {'name': name, 'open': data.get('open') is True}

    def check(self, token, project):
        # Cada evidencia puede fallar independientemente; desconocido nunca equivale a habilitado.
        result = {'billing': 'unknown', 'vertex': 'unknown', 'permissions': 'unknown', 'credits': 'unverified'}
        project_id, resource = project['id'], project['resource']
        checks = [
            ('billing', 'GET', f'https://cloudbilling.googleapis.com/v1/projects/{project_id}/billingInfo', None),
            ('vertex', 'GET', f'https://serviceusage.googleapis.com/v1/{resource}/services/aiplatform.googleapis.com', None),
            ('permissions', 'POST', f'https://cloudresourcemanager.googleapis.com/v1/projects/{project_id}:testIamPermissions', {'permissions': PERMISSIONS}),
        ]
        for key, method, url, body in checks:
            try:
                data = self.request(token, method, url, body)
                ok = (data.get('billingEnabled') is True if key == 'billing' else
                      data.get('state') == 'ENABLED' if key == 'vertex' else
                      set(PERMISSIONS) <= set(data.get('permissions', [])))
                result[key] = 'enabled' if ok else 'missing'
            except CloudError as error:
                if error.code == 'reauthorize':
                    raise
        result['ready'] = all(result[key] == 'enabled' for key in ('billing', 'vertex', 'permissions'))
        return result
