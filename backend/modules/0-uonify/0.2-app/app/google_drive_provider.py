"""Drive por REST; sin enlaces arbitrarios, tokens en frontend ni escritura sobre originales."""
import json
import re
from uuid import uuid4
import requests
from .google_cloud_provider import Backoff, GoogleCloudProvider, CloudError, error_reason

BASE = 'https://www.googleapis.com/drive/v3/files'
# A Drive 403 is not always a lost permission (ADK-FLUJOS audit F0.5, ficha
# google-drive-api.md §4.7/§7): rate limits are retried on idempotent reads,
# an oversized export or a file-level refusal gets its own message, and only
# a lost authorization asks the customer to reconnect.
RATE_REASONS = frozenset({'rateLimitExceeded', 'userRateLimitExceeded'})
RECONNECT_REASONS = frozenset({'insufficientPermissions', 'authError'})
RETRY_STATUS = frozenset({429, 500, 502, 503, 504})
FOLDER = 'application/vnd.google-apps.folder'
# The 'root' alias in parents is My Drive's root (ficha google-drive-api).
ROOT_FOLDERS = "'root' in parents and mimeType = '" + FOLDER + "' and trashed = false"
COUNT_PAGES = 10  # 1000 ids per page: past 10,000 root folders, «al menos N».
FIELDS = 'id,name,mimeType,size,modifiedTime,capabilities(canDownload),trashed'
MAX_BYTES = 20 * 1024 * 1024
EXPORTS = {'application/vnd.google-apps.document': ('text/plain', '.txt'),
           'application/vnd.google-apps.spreadsheet': ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'),
           'application/vnd.google-apps.presentation': ('application/pdf', '.pdf')}


def file_id(value):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', value):
        raise CloudError('invalid_file')
    return value


def public_file(item):
    return {key: item[key] for key in ('id', 'name', 'mimeType', 'size', 'modifiedTime') if key in item}


class GoogleDriveProvider(GoogleCloudProvider):
    # Lectura para localizar archivos existentes; escritura solo sobre archivos creados por la app.
    scopes = ('https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file')
    max_retries = 2

    def retryable(self, response):
        return (response.status_code in RETRY_STATUS or
                response.status_code == 403 and error_reason(response) in RATE_REASONS)

    def http_error(self, response):
        status, reason = response.status_code, error_reason(response)
        if status == 401 or reason == 'authError':
            return CloudError('reauthorize')
        if status == 429 or reason in RATE_REASONS:
            return CloudError('rate_limited')
        if status == 404:
            return CloudError('invalid_file')
        if status == 403:
            if reason == 'exportSizeLimitExceeded':
                return CloudError('file_too_large')
            if reason == 'dailyLimitExceeded':
                return CloudError('quota_exceeded')
            if reason in RECONNECT_REASONS or reason is None:
                # Conscious deviation from «only insufficientPermissions or
                # authError reconnects»: a 403 without a readable reason fails
                # closed as a permission problem («Consultor google», F0.5).
                return CloudError('permission_denied')
            return CloudError('file_forbidden')
        return CloudError()

    def probe_access(self, token):
        """Check My Drive access without listing document names or metadata."""
        data = self.request(token, 'GET', BASE + '/root',
                            params={'fields': 'id', 'supportsAllDrives': 'true'})
        if not isinstance(data, dict) or not isinstance(data.get('id'), str) or not data['id']:
            raise CloudError('invalid_response')
        return True

    def count_folders(self, token):
        """The same count for the voice, which only says an exact number."""
        result = self.count_root_folders(token)
        if result['truncated']:
            raise CloudError('incomplete_search')
        return result['count']

    def count_root_folders(self, token):
        """Count the untrashed folders at the root of My Drive, the ones the
        customer sees on opening it (owner, 21-10-2026; «Consultor google»):
        never subfolders, shared drives or «Compartido conmigo».

        Fetch IDs for pagination/deduplication, never names or file contents.
        A partial search (incompleteSearch) or more than COUNT_PAGES pages
        make the count a lower bound (truncated), never an exact number; an
        invalid page is never a count.
        """
        identifiers, page, seen_pages = set(), None, set()
        for _ in range(COUNT_PAGES):
            data = self.request(token, 'GET', BASE, params={
                'q': ROOT_FOLDERS, 'corpora': 'user', 'spaces': 'drive', 'pageSize': 1000,
                'pageToken': page, 'fields': 'nextPageToken,incompleteSearch,files(id)',
                'supportsAllDrives': 'true', 'includeItemsFromAllDrives': 'true',
            })
            if not isinstance(data, dict):
                raise CloudError('incomplete_search')
            files = data.get('files', [])
            if not isinstance(files, list):
                raise CloudError('incomplete_search')
            for item in files:
                if not isinstance(item, dict) or not isinstance(item.get('id'), str):
                    raise CloudError('incomplete_search')
                try:
                    identifiers.add(file_id(item['id']))
                except CloudError:
                    raise CloudError('incomplete_search') from None
            if data.get('incompleteSearch') is True:  # Some results may be missing.
                return {'count': len(identifiers), 'truncated': True}
            next_page = data.get('nextPageToken')
            if not next_page:
                return {'count': len(identifiers), 'truncated': False}
            if not isinstance(next_page, str) or next_page in seen_pages:
                raise CloudError('incomplete_search')
            seen_pages.add(next_page)
            page = next_page
        return {'count': len(identifiers), 'truncated': True}

    def files(self, token, parent='root', page=None, search=''):
        parent = file_id(parent)
        query = "trashed = false"
        if search:
            escaped = search.replace('\\', '\\\\').replace("'", "\\'")
            query += " and name contains '" + escaped + "'"
        else:
            query += f" and '{parent}' in parents"
        data = self.request(token, 'GET', BASE, params={'q': query, 'pageSize': 50,
            'pageToken': page, 'fields': f'nextPageToken,files({FIELDS})',
            'orderBy': 'folder,name', 'supportsAllDrives': 'true', 'includeItemsFromAllDrives': 'true'})
        return {'files': [public_file(x) for x in data.get('files', [])], 'nextPageToken': data.get('nextPageToken')}

    def metadata(self, token, identifier):
        item = self.request(token, 'GET', BASE + '/' + file_id(identifier),
                            params={'fields': FIELDS, 'supportsAllDrives': 'true'})
        if item.get('trashed'):
            raise CloudError('invalid_file')
        return item

    def folder(self, token):
        data = self.request(token, 'GET', BASE, params={'q': "trashed=false and mimeType='" + FOLDER + "' and appProperties has { key='uonifyFolder' and value='materials' }", 'fields': 'files(id)', 'pageSize': 1})
        if data.get('files'):
            return data['files'][0]['id']
        item = self.request(token, 'POST', BASE, body={'name': 'Uonify', 'mimeType': FOLDER,
                'appProperties': {'uonifyFolder': 'materials'}}, params={'fields': 'id'})
        return item['id']

    def reserve_id(self, token):
        return self.request(token, 'GET', BASE + '/generateIds', params={'count': 1, 'space': 'drive'})['ids'][0]

    def upload(self, token, folder, identifier, name, mime, content):
        boundary = 'uonify-' + uuid4().hex
        metadata = json.dumps({'id': identifier, 'name': name, 'parents': [file_id(folder)]}, ensure_ascii=False).encode()
        payload = (f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'.encode() + metadata +
                   f'\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n'.encode() + content + f'\r\n--{boundary}--\r\n'.encode())
        try:
            response = requests.post('https://www.googleapis.com/upload/drive/v3/files',
                params={'uploadType': 'multipart', 'fields': FIELDS}, data=payload,
                headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary}, timeout=60)
            if response.status_code == 409:
                return self.metadata(token, identifier)  # Reintento del mismo ID reservado.
            if not 200 <= response.status_code < 300:
                # A write is never retried; its error is classified like a read.
                raise self.http_error(response)
            return response.json()
        except (requests.RequestException, ValueError):
            raise CloudError() from None

    def content(self, token, identifier, max_bytes=MAX_BYTES):
        if not isinstance(max_bytes, int) or not 1 <= max_bytes <= 64 * 1024 * 1024:
            raise CloudError('file_too_large')
        item = self.metadata(token, identifier)
        if item.get('capabilities', {}).get('canDownload') is False:
            raise CloudError('file_forbidden')  # The owner disabled downloads.
        if int(item.get('size', 0)) > max_bytes:
            raise CloudError('file_too_large')
        mime, name = item['mimeType'], item['name']
        url = BASE + '/' + file_id(identifier)
        params = {'alt': 'media', 'supportsAllDrives': 'true'}
        if mime in EXPORTS:
            mime, suffix = EXPORTS[mime]
            name += suffix
            url += '/export'; params = {'mimeType': mime}
        elif mime.startswith('application/vnd.google-apps.'):
            raise CloudError('unsupported_file')
        waits = Backoff()
        for attempt in range(self.max_retries + 1):
            try:
                with requests.get(url, params=params, headers={'Authorization': 'Bearer ' + token}, stream=True, timeout=30, allow_redirects=False) as response:
                    if response.status_code != 200:
                        if (attempt < self.max_retries and self.retryable(response)
                                and waits.wait(attempt, response)):
                            continue
                        raise self.http_error(response)
                    chunks, size = [], 0
                    for chunk in response.iter_content(65536):
                        size += len(chunk)
                        if size > max_bytes:
                            raise CloudError('file_too_large')
                        chunks.append(chunk)
                return b''.join(chunks), mime, name
            except requests.ConnectionError:
                if attempt < self.max_retries and waits.wait(attempt):
                    continue
                raise CloudError() from None
            except requests.RequestException:
                raise CloudError() from None
        raise CloudError()
