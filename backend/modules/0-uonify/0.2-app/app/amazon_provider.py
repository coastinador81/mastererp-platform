"""Configuración y LWA. Ninguna credencial se publica ni se registra en logs."""
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlencode
import ipaddress
import json
import re

LOGIN_PATH = '/integrations/amazon/login'
CALLBACK_PATH = '/integrations/amazon/callback'
SELLER_ORIGIN = 'https://sellercentral-europe.amazon.com'
APP_PATTERN = r'amzn1\.(?:sellerapps\.app|sp\.solution)\.[A-Za-z0-9-]{8,100}'
CLIENT_PATTERN = r'amzn1\.application-oa2-client\.[A-Za-z0-9-]{8,100}'


def public_origin(value):
    if not isinstance(value, str) or not value:
        return ''
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ''
        if (parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443)
                or parsed.path not in ('', '/') or parsed.query or parsed.fragment or '%' in value
                or not re.fullmatch(r'[a-z0-9.-]+', host) or '.' not in host
                or host.endswith(('.localhost', '.local', '.internal'))):
            return ''
        try:
            ipaddress.ip_address(host)
            return ''
        except ValueError:
            pass
        return 'https://' + host
    except ValueError:
        return ''


@dataclass(frozen=True, repr=False)
class AmazonConfig:
    origin: str = ''
    application_id: str = ''
    client_id: str = ''
    client_secret: str = ''

    @property
    def ready(self):
        return bool(self.origin and self.application_id and self.client_id and self.client_secret)

    @property
    def login_uri(self):
        return self.origin + LOGIN_PATH if self.origin else None

    @property
    def redirect_uri(self):
        return self.origin + CALLBACK_PATH if self.origin else None

    def status(self):
        return {'httpsReady': bool(self.origin), 'applicationReady': bool(self.application_id),
                'credentialsReady': bool(self.client_id and self.client_secret),
                'loginUri': self.login_uri, 'redirectUri': self.redirect_uri}


def load_config(settings):
    directory = Path(settings.secrets_directory)
    try:
        value = json.loads((directory / 'amazon-config.json').read_text())
        secret_file = directory / 'amazon-client-secret'
        app_id = value.get('applicationId', '')
        client_id = value.get('clientId', '')
        secret = secret_file.read_text().strip() if secret_file.is_file() else ''
        return AmazonConfig(public_origin(value.get('publicOrigin', '')),
                            app_id if isinstance(app_id, str) and re.fullmatch(APP_PATTERN, app_id) else '',
                            client_id if isinstance(client_id, str) and re.fullmatch(CLIENT_PATTERN, client_id) else '',
                            secret if 20 <= len(secret) <= 16384 else '')
    except (OSError, ValueError, TypeError, AttributeError):
        return AmazonConfig()


class AmazonProvider:
    def __init__(self, settings, config=None):
        self.config = config or load_config(settings)

    def authorization_url(self, state):
        return SELLER_ORIGIN + '/apps/authorize/consent?' + urlencode({
            'application_id': self.config.application_id, 'state': state,
            'redirect_uri': self.config.redirect_uri, 'version': 'beta'})

    def exchange(self, code):
        import httpx
        if not self.config.ready:
            raise ValueError('amazon_not_configured')
        with httpx.Client(timeout=12, follow_redirects=False) as client:
            result = client.post('https://api.amazon.com/auth/o2/token', data={
                'grant_type': 'authorization_code', 'code': code,
                'redirect_uri': self.config.redirect_uri,
                'client_id': self.config.client_id, 'client_secret': self.config.client_secret})
        if result.status_code != 200:
            raise ValueError('amazon_unavailable')
        refresh = result.json().get('refresh_token')
        if not isinstance(refresh, str) or not 20 <= len(refresh) <= 16384:
            raise ValueError('invalid_response')
        return refresh


def validate_amazon_callback(value, config):
    """Solo la confirmación regional exacta; jamás hace una petición al valor recibido."""
    try:
        parsed = urlsplit(value)
        expected = '/apps/authorize/confirm/' + config.application_id
        if (not config.application_id or parsed.scheme != 'https'
                or parsed.netloc not in ('sellercentral-europe.amazon.com', 'amazon.com')
                or parsed.path != expected or parsed.query or parsed.fragment):
            raise ValueError('invalid_callback')
        return 'https://' + parsed.netloc + expected
    except (ValueError, TypeError):
        raise ValueError('invalid_callback') from None
