"""AMZ-05: durable, read-only observations after a Listings PUT receipt.

ACCEPTED is an initial receipt, never publication. A GET describes the current
seller/SKU/marketplace listing; it cannot prove that our PUT caused that state.
This coordinator has no route, scheduler, live provider, or open network gate.
"""
from datetime import datetime, timezone, timedelta
from uuid import UUID, uuid4
import json
import re

from fastapi import APIRouter, Request
from psycopg.types.json import Jsonb

from .amazon_catalog import AmazonReadError
from .amazon_publish_ledger import _current_user
from .amazon_publish_snapshots import digest
from .onboarding import require_user
from .products import fail


ASIN = re.compile(r'^[A-Z0-9]{10}$')
MAX_RESPONSE_BYTES = 128_000
MAX_ISSUES_BYTES = 64_000
# Per-attempt guard for distinct request IDs. Amazon visibility can take minutes;
# one GET per minute is enough for an interactive follow-up without burst reads.
FOLLOWUP_COOLDOWN = timedelta(seconds=60)
# Three ordinary 30 s GET attempts plus two 30 s Retry-After waits may take
# about 150 s. This margin avoids early reclaim in that case; before opening
# the real-provider gate, add a strict total deadline or renewable lease because
# HTTPX's timeout is not a whole-request wall-clock bound.
FOLLOWUP_ABANDONED_SECONDS = 180


def _attempt(c, user, attempt_id, *, lock=False):
    row = c.execute('''SELECT a.*, p.sku, p.seller_id, p.marketplace_id,
        p.product_type, p.snapshot_id, p.product_id
        FROM amazon_publish_attempts a
        JOIN amazon_publish_approvals p ON p.user_id=a.user_id AND p.id=a.approval_id
        WHERE a.user_id=%s AND a.id=%s''' + (' FOR UPDATE OF a' if lock else ''),
        (user['id'], attempt_id)).fetchone()
    if not row:
        fail('amazon_attempt_not_found', 'No se encuentra este intento en tu cuenta.', 404)
    return row


def _observation_view(row):
    if row is None:
        return None
    return {'checkId': str(row['id']), 'requestId': str(row['request_id']),
            'status': row['status'], 'result': row['result'],
            'startedAt': row['started_at'].isoformat(),
            'checkedAt': row['checked_at'].isoformat() if row['checked_at'] else None,
            'listingStatus': row['listing_status'], 'issues': row['issues'],
            'asin': row['asin'], 'listingUpdatedAt': (
                row['listing_updated_at'].isoformat() if row['listing_updated_at'] else None),
            'productTypeMatch': row['product_type_match'],
            'snapshotMatch': row['snapshot_match'],
            'listingFingerprint': row['listing_fingerprint'], 'errorCode': row['error_code']}


def load_status(c, user, attempt_id):
    """Return a tenant-scoped timeline summary; never infer a sale or a PUT result."""
    user = _current_user(c, user)
    attempt = _attempt(c, user, attempt_id)
    latest = c.execute('''SELECT * FROM amazon_publish_followups
        WHERE user_id=%s AND attempt_id=%s ORDER BY started_at DESC,id DESC LIMIT 1''',
        (user['id'], attempt_id)).fetchone()
    known = c.execute('''SELECT * FROM amazon_publish_followups
        WHERE user_id=%s AND attempt_id=%s AND status='done'
        ORDER BY checked_at DESC,id DESC LIMIT 1''',
        (user['id'], attempt_id)).fetchone()
    latest_clean = bool(latest and known and latest['id'] == known['id'])
    fresh = bool(known and known['checked_at']
                 and datetime.now(timezone.utc) - known['checked_at'] <= timedelta(minutes=15))
    verified_now = bool(latest_clean and fresh and known['result'] == 'visible_current')
    phase = ('rejected_initial' if attempt['status'] == 'invalid' else
             'outcome_unknown' if attempt['status'] == 'unknown' else
             'reserved' if attempt['status'] == 'reserved' else
             'visibility_check_stale' if latest_clean and known['result'] == 'visible_current'
             and not fresh else known['result'] if latest_clean else
             'checking' if latest and latest['status'] == 'checking' else
             'check_failed' if latest and latest['status'] == 'read_error' else
             'awaiting_amazon')
    return {'attemptId': str(attempt['id']), 'submissionId': attempt['submission_id'],
            'submissionStatus': attempt['status'], 'sku': attempt['sku'],
            'sellerId': attempt['seller_id'], 'marketplaceId': attempt['marketplace_id'],
            'phase': phase, 'latestCheck': _observation_view(latest),
            'lastAuthoritativeObservation': _observation_view(known),
            'currentVisibilityVerified': verified_now,
            'visibleForCurrentSku': verified_now,
            'causedByThisSubmission': None,
            'retailLinkVerified': False, 'published': False,
            'notice': ('Amazon aceptó inicialmente la solicitud; el estado visible se comprueba por separado.'
                       if attempt['status'] == 'accepted_initial' else
                       'Este intento no tiene una aceptación inicial confirmada.')}


def _reserve(c, user, attempt_id, request_id):
    user = _current_user(c, user)
    # Serialize reservations for this tenant's attempt. A unique active-check
    # index alone cannot stop two rapid, sequential GETs with different IDs.
    attempt = _attempt(c, user, attempt_id, lock=True)
    if attempt['status'] != 'accepted_initial':
        fail('amazon_followup_not_eligible',
             'Solo se comprueba automáticamente un envío aceptado inicialmente.', 409)
    prior = c.execute('''SELECT * FROM amazon_publish_followups
        WHERE user_id=%s AND request_id=%s''', (user['id'], request_id)).fetchone()
    if prior:
        if prior['attempt_id'] != attempt_id:
            fail('amazon_followup_request_conflict',
                 'Esta petición ya corresponde a otra comprobación.', 409)
        return prior, False, attempt
    # A read is safe to repeat after a crash, but a live worker must not race
    # another one or misrepresent an abandoned check as fresh evidence.
    c.execute('''UPDATE amazon_publish_followups SET status='read_error',
        checked_at=statement_timestamp(),error_code='check_interrupted'
        WHERE user_id=%s AND attempt_id=%s AND status='checking'
        AND started_at < statement_timestamp()-(%s * interval '1 second') ''',
        (user['id'], attempt_id, FOLLOWUP_ABANDONED_SECONDS))
    active = c.execute('''SELECT * FROM amazon_publish_followups
        WHERE user_id=%s AND attempt_id=%s AND status='checking' ''',
        (user['id'], attempt_id)).fetchone()
    if active:
        return active, False, attempt
    # An interrupted reservation has no confirmed GET result and does not
    # extend the cooldown. Preserve an actual 429/error as the latest evidence.
    recent = c.execute('''SELECT * FROM amazon_publish_followups
        WHERE user_id=%s AND attempt_id=%s AND checked_at IS NOT NULL
        AND error_code IS DISTINCT FROM 'check_interrupted'
        AND checked_at > statement_timestamp() - %s::interval
        ORDER BY checked_at DESC,id DESC LIMIT 1''',
        (user['id'], attempt_id, FOLLOWUP_COOLDOWN)).fetchone()
    if recent:
        return recent, False, attempt
    row = c.execute('''INSERT INTO amazon_publish_followups
        (id,user_id,attempt_id,request_id,status)
        VALUES(%s,%s,%s,%s,'checking') ON CONFLICT DO NOTHING RETURNING *''',
        (uuid4(), user['id'], attempt_id, request_id)).fetchone()
    if not row:
        row = c.execute('''SELECT * FROM amazon_publish_followups
            WHERE user_id=%s AND attempt_id=%s AND status='checking' ''',
            (user['id'], attempt_id)).fetchone()
        if row:
            return row, False, attempt
        prior = c.execute('''SELECT * FROM amazon_publish_followups
            WHERE user_id=%s AND request_id=%s''', (user['id'], request_id)).fetchone()
        if prior and prior['attempt_id'] == attempt_id:
            return prior, False, attempt
        fail('amazon_followup_busy', 'La comprobación ya se está ejecutando.', 409)
    return row, True, attempt


def _datetime(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result.astimezone(timezone.utc) if result.tzinfo else None
    except ValueError:
        return None


def _parse_item(item, attempt, snapshot):
    if (not isinstance(item, dict) or item.get('sku') != attempt['sku']
            or not isinstance(item.get('attributes'), dict)
            or not isinstance(item.get('summaries'), list)
            or not isinstance(item.get('productTypes'), list)
            or not isinstance(item.get('issues'), list)
            or len(json.dumps(item, ensure_ascii=False, default=str)) > MAX_RESPONSE_BYTES):
        raise ValueError('incomplete_listing_snapshot')
    summaries = [value for value in item['summaries'] if isinstance(value, dict)
                 and value.get('marketplaceId') == attempt['marketplace_id']]
    types = [value for value in item['productTypes'] if isinstance(value, dict)
             and value.get('marketplaceId') == attempt['marketplace_id']]
    summary = summaries[0] if len(summaries) == 1 else None
    statuses = summary.get('status', []) if summary else []
    if not isinstance(statuses, list) or any(not isinstance(value, str) for value in statuses):
        raise ValueError('invalid_listing_status')
    issues = []
    for issue in item['issues']:
        if not isinstance(issue, dict) or not isinstance(issue.get('code'), str) or not isinstance(issue.get('message'), str):
            raise ValueError('invalid_listing_issue')
        issues.append({key: issue[key] for key in ('code','message','severity','attributeNames')
                       if key in issue})
    if len(json.dumps(issues, ensure_ascii=False, default=str)) > MAX_ISSUES_BYTES:
        raise ValueError('oversized_listing_issues')
    matching_type = any(value.get('productType') == attempt['product_type'] for value in types)
    submitted_attrs = snapshot['payload']['attributes']
    matching_attrs = bool(submitted_attrs) and all(
        item['attributes'].get(key) == values for key, values in submitted_attrs.items())
    asin = summary.get('asin') if summary else None
    if not isinstance(asin, str) or not ASIN.fullmatch(asin):
        asin = None
    blocking = any(issue.get('severity') == 'ERROR' for issue in issues)
    visible = bool(summary and asin and matching_type and matching_attrs
                   and not blocking and 'DELETED' not in statuses
                   and ('DISCOVERABLE' in statuses or 'BUYABLE' in statuses))
    if blocking:
        result = 'issues'
    elif visible:
        result = 'visible_current'
    elif not matching_type or not matching_attrs or not summary:
        result = 'unmatched'
    else:
        result = 'listing_present'
    return {'result': result, 'listingStatus': statuses, 'issues': issues,
            'asin': asin, 'listingUpdatedAt': _datetime(summary.get('lastUpdatedDate') if summary else None),
            'productTypeMatch': matching_type, 'snapshotMatch': matching_attrs,
            'listingFingerprint': digest({'attributes': item['attributes'],
                                          'summaries': item['summaries'],
                                          'productTypes': item['productTypes']})}


def reconcile_once(database, user, attempt_id, request_id, provider, *, gate_open=False):
    """One bounded GET with injected provider; never sends, patches, or retries a PUT."""
    if not gate_open:
        fail('amazon_followup_disabled', 'La comprobación Amazon aún no está habilitada.', 409)
    with database.connect() as c:
        row, created, attempt = _reserve(c, user, attempt_id, request_id)
        if not created:
            return load_status(c, user, attempt_id)
        snapshot = c.execute('''SELECT s.payload FROM amazon_publish_snapshots s
            WHERE s.user_id=%s AND s.id=%s''',
            (user['id'], attempt['snapshot_id'])).fetchone()
    try:
        item = provider.item(attempt['seller_id'], attempt['marketplace_id'], attempt['sku'])
        parsed = _parse_item(item, attempt, snapshot)
        status, error = 'done', None
    except AmazonReadError as exc:
        if exc.status == 404:
            status, error = 'done', None
            parsed = {'result': 'not_found', 'listingStatus': [], 'issues': [],
                      'asin': None, 'listingUpdatedAt': None,
                      'productTypeMatch': None, 'snapshotMatch': None,
                      'listingFingerprint': None}
        else:
            status, error, parsed = 'read_error', 'amazon_read_unavailable', {}
    except (ValueError, TypeError, KeyError):
        status, error, parsed = 'read_error', 'amazon_response_incomplete', {}
    except Exception:
        status, error, parsed = 'read_error', 'amazon_read_unavailable', {}
    with database.connect() as c:
        c.execute('''UPDATE amazon_publish_followups SET status=%s,result=%s,
            checked_at=now(),listing_status=%s,issues=%s,asin=%s,
            listing_updated_at=%s,product_type_match=%s,snapshot_match=%s,
            listing_fingerprint=%s,error_code=%s
            WHERE user_id=%s AND id=%s AND status='checking' ''',
            (status, parsed.get('result'), Jsonb(parsed.get('listingStatus', [])),
             Jsonb(parsed.get('issues', [])), parsed.get('asin'),
             parsed.get('listingUpdatedAt'), parsed.get('productTypeMatch'),
             parsed.get('snapshotMatch'), parsed.get('listingFingerprint'), error,
             user['id'], row['id']))
        return load_status(c, user, attempt_id)


def routes(database):
    """Read-only status endpoint; deliberately not mounted until migration 059."""
    router = APIRouter(prefix='/api/products')

    @router.get('/{sku}/amazon-publish-attempts/{attempt_id}')
    def status(sku: str, attempt_id: UUID, request: Request):
        with database.connect() as c:
            result = load_status(c, require_user(c, request), attempt_id)
            if result['sku'] != sku:
                fail('amazon_attempt_not_found', 'No se encuentra este intento en tu cuenta.', 404)
            return result

    return router
