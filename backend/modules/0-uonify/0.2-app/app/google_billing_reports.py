"""Fixed, project-scoped App Optimize reports. No AI, BigQuery or credit estimates."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re
from zoneinfo import ZoneInfo
import requests
from .google_cloud_provider import CloudError

ROOT = 'https://appoptimize.googleapis.com/v1beta/'
DOCS_URL = 'https://docs.cloud.google.com/app-optimize/optimization-data'
LATENCY_MESSAGE = 'Google publica el coste bruto antes de créditos; los datos pueden tardar más de 24 horas en aparecer.'
PROJECT = re.compile(r'[a-z][a-z0-9-]{4,28}[a-z0-9]')
IDENTIFIER = re.compile(r'[a-z][a-z0-9-]{0,61}[a-z0-9]|[a-z]')
MAX_PAGES = 5
MAX_ROWS = 1000


class BillingReportError(CloudError):
    def __init__(self, code='google_unavailable', *, retry_after=None):
        super().__init__(code)
        self.retry_after = retry_after


def project_name(project):
    if not isinstance(project, str) or not PROJECT.fullmatch(project):
        raise BillingReportError('invalid_project')
    return 'projects/' + project


def report_name(project, identifier):
    project_name(project)
    if not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier):
        raise BillingReportError('invalid_report')
    return f'projects/{project}/locations/global/reports/{identifier}'


def instant(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            raise BillingReportError('invalid_response') from None
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise BillingReportError('invalid_response')
    return value.astimezone(timezone.utc)


def month_period(now=None):
    end = instant(now or datetime.now(timezone.utc)).replace(microsecond=0)
    local = end.astimezone(ZoneInfo('America/Los_Angeles'))
    start = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.astimezone(timezone.utc) >= end:
        raise BillingReportError('period_not_ready')
    return start.astimezone(timezone.utc), end


def report_filter(start, end):
    first, last = instant(start), instant(end)
    if not first < last or last - first > timedelta(days=90):
        raise BillingReportError('invalid_period')
    stamp = lambda value: value.isoformat(timespec='seconds').replace('+00:00', 'Z')
    return f"hour >= timestamp('{stamp(first)}') && hour < timestamp('{stamp(last)}')"


def _alias(data, camel, snake):
    if camel in data and snake in data and data[camel] != data[snake]:
        raise BillingReportError('invalid_response')
    return data.get(camel, data.get(snake))


def _integer(value, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (str, int)) or not re.fullmatch(r'-?\d+', str(value)):
        raise BillingReportError('invalid_response')
    result = int(value)
    if not minimum <= result <= maximum:
        raise BillingReportError('invalid_response')
    return result


def monetary(value):
    """Google Money uses signed units/nanos. Never coerce USD, null or a float."""
    if not isinstance(value, dict):
        raise BillingReportError('invalid_response')
    currency = _alias(value, 'currencyCode', 'currency_code')
    if not isinstance(currency, str) or not re.fullmatch(r'[A-Z]{3}', currency):
        raise BillingReportError('invalid_response')
    if currency != 'EUR':
        raise BillingReportError('unsupported_currency')
    # Proto JSON omits scalar defaults: a present EUR Money object can be zero.
    units = _integer(value.get('units', '0'), -(2**63), 2**63 - 1)
    nanos = _integer(value.get('nanos', 0), -999999999, 999999999)
    if (units > 0 and nanos < 0) or (units < 0 and nanos > 0):
        raise BillingReportError('invalid_response')
    return Decimal(units) + Decimal(nanos) / Decimal(1000000000)


def parse_page(data, project):
    if not isinstance(data, dict) or not isinstance(data.get('columns'), list):
        raise BillingReportError('invalid_response')
    columns = data['columns']
    names = [c.get('name') if isinstance(c, dict) else None for c in columns]
    if len(names) != 2 or set(names) != {'project', 'cost'}:
        raise BillingReportError('invalid_response')
    mapping = dict(zip(names, columns))
    if (mapping['project'].get('type') != 'STRING' or mapping['cost'].get('type') != 'RECORD' or
            any(c.get('mode', 'NULLABLE') not in ('NULLABLE', 'REQUIRED') for c in columns)):
        raise BillingReportError('invalid_response')
    nested = mapping['cost'].get('columns')
    if not isinstance(nested, list) or len(nested) != 3 or not all(isinstance(c, dict) for c in nested):
        raise BillingReportError('invalid_response')
    nested_types = {c.get('name'): c.get('type') for c in nested}
    if nested_types not in ({'currency_code': 'STRING', 'units': 'INT64', 'nanos': 'INT64'},
                            {'currencyCode': 'STRING', 'units': 'INT64', 'nanos': 'INT64'}):
        raise BillingReportError('invalid_response')
    if any(c.get('mode', 'NULLABLE') not in ('NULLABLE', 'REQUIRED') for c in nested):
        raise BillingReportError('invalid_response')
    rows = data.get('rows', [])
    if not isinstance(rows, list) or len(rows) > MAX_ROWS:
        raise BillingReportError('too_many_rows' if isinstance(rows, list) else 'invalid_response')
    result = []
    for row in rows:
        if not isinstance(row, list) or len(row) != len(columns) or row[names.index('project')] != project_name(project):
            raise BillingReportError('invalid_response')
        result.append(monetary(row[names.index('cost')]))
    next_page = _alias(data, 'nextPageToken', 'next_page_token')
    if next_page is not None and (not isinstance(next_page, str) or len(next_page) > 4096):
        raise BillingReportError('invalid_response')
    return result, next_page


class GoogleBillingReports:
    def _request(self, token, project, method, name, body=None, params=None):
        project_name(project)
        try:
            response = requests.request(method, ROOT + name,
                headers={'Authorization': 'Bearer ' + token, 'X-Goog-User-Project': project},
                json=body, params=params, timeout=(3.05, 10), allow_redirects=False)
            try:
                data = response.json()
            except ValueError:
                data = None
            if response.status_code >= 300:
                error = data.get('error', {}) if isinstance(data, dict) else {}
                details = error.get('details', []) if isinstance(error, dict) else []
                reasons = {item['reason'] for item in details if isinstance(item, dict) and
                           isinstance(item.get('reason'), str)} if isinstance(details, list) else set()
                code = {401: 'reauthorize', 403: 'permission_denied', 404: 'not_found',
                        409: 'already_exists', 429: 'quota_exceeded'}.get(response.status_code, 'google_unavailable')
                if 'SERVICE_DISABLED' in reasons:
                    code = 'service_disabled'
                raise BillingReportError(code, retry_after=60 if response.status_code == 429 else None)
            if not isinstance(data, dict):
                raise BillingReportError('invalid_response')
            return data
        except BillingReportError:
            raise
        except (requests.RequestException, ValueError, TypeError):
            # An uncertain create is reconciled by the same report ID, never retried here.
            raise BillingReportError() from None

    def _definition(self, project, start, end):
        return {'scopes': [{'project': project_name(project)}], 'dimensions': ['project'],
                'metrics': ['cost'], 'filter': report_filter(start, end)}

    def _metadata(self, data, project, identifier, start, end):
        expected = self._definition(project, start, end)
        if not isinstance(data, dict) or data.get('name') != report_name(project, identifier):
            raise BillingReportError('invalid_response')
        if any(data.get(key) != value for key, value in expected.items()):
            raise BillingReportError('invalid_response')
        expiry = _alias(data, 'expireTime', 'expire_time')
        if expiry is not None and instant(expiry) <= datetime.now(timezone.utc):
            raise BillingReportError('report_expired')
        return {'reportName': data['name'], 'status': 'ready', 'expiresAt': expiry}

    def _operation(self, data, project, identifier, start, end, expected_name=None):
        prefix = f'projects/{project}/locations/global/operations/'
        name = data.get('name') if isinstance(data, dict) else None
        if (not isinstance(name, str) or not name.startswith(prefix) or
                not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', name[len(prefix):]) or
                (expected_name is not None and name != expected_name)):
            raise BillingReportError('invalid_response')
        if 'done' in data and not isinstance(data['done'], bool):
            raise BillingReportError('invalid_response')
        if data.get('done'):
            if data.get('error'):
                error = data['error']
                code = {7: 'permission_denied', 8: 'quota_exceeded', 16: 'reauthorize'}.get(error.get('code')) if isinstance(error, dict) else None
                raise BillingReportError(code or 'google_unavailable')
            result = self._metadata(data.get('response'), project, identifier, start, end)
        else:
            if data.get('response') or data.get('error'):
                raise BillingReportError('invalid_response')
            result = {'reportName': report_name(project, identifier), 'status': 'pending'}
        return {**result, 'operationName': name}

    def create(self, token, project, identifier, period_start, period_end):
        report_name(project, identifier)
        body = self._definition(project, period_start, period_end)
        data = self._request(token, project, 'POST', f'projects/{project}/locations/global/reports',
                             body, {'reportId': identifier})
        return self._operation(data, project, identifier, period_start, period_end)

    def poll(self, token, project, operation_name, identifier, period_start, period_end):
        prefix = f'projects/{project}/locations/global/operations/'
        report_name(project, identifier)
        if (not isinstance(operation_name, str) or not operation_name.startswith(prefix) or
                not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', operation_name[len(prefix):])):
            raise BillingReportError('invalid_operation')
        data = self._request(token, project, 'GET', operation_name)
        return self._operation(data, project, identifier, period_start, period_end, operation_name)

    def metadata(self, token, project, identifier, period_start, period_end):
        name = report_name(project, identifier)
        data = self._request(token, project, 'GET', name)
        return self._metadata(data, project, identifier, period_start, period_end)

    def read(self, token, project, identifier):
        name = report_name(project, identifier)
        values, seen_tokens, next_page = [], set(), None
        for _ in range(MAX_PAGES):
            data = self._request(token, project, 'POST', name + ':read',
                                 {'pageSize': 100, **({'pageToken': next_page} if next_page else {})})
            amounts, next_page = parse_page(data, project)
            values.extend(amounts)
            # With only project as dimension and one scope there is at most one
            # aggregate. Repeated rows are not additional costs to add again.
            if len(values) > 1:
                raise BillingReportError('invalid_response')
            if not next_page:
                if not values:
                    return {'status': 'no_records', 'consumptionEUR': None, 'currency': None, 'rowCount': 0}
                try:
                    total = sum(values, Decimal(0)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                except InvalidOperation:
                    raise BillingReportError('invalid_response') from None
                if total == 0:
                    total = abs(total)
                return {'status': 'available', 'consumptionEUR': format(total, '.2f'), 'currency': 'EUR', 'rowCount': len(values)}
            if next_page in seen_tokens:
                raise BillingReportError('invalid_response')
            seen_tokens.add(next_page)
        raise BillingReportError('too_many_pages')
