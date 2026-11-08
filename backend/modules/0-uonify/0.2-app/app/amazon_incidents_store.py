"""Snapshots e incidencias por propietario, vendedor, mercado y SKU exacto."""
from datetime import datetime, timezone
import hashlib
import json
from uuid import uuid4
from psycopg.types.json import Jsonb
from .amazon_listings_provider import MARKETS
from .amazon_store import fail


def now():
    return datetime.now(timezone.utc)


def iso(value):
    return value.isoformat() if value else None


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def attrs(issue):
    values = issue.get('attributeNames') or ([issue['attributeName']] if issue.get('attributeName') else [])
    return sorted(set(v for v in values if isinstance(v, str)))


def issue_key(issue):
    # Code+affected attributes is Amazon's stable identity; localized prose/severity can change.
    return fingerprint({'code': issue['code'], 'attributes': attrs(issue)})


def history(row, event, message):
    return [*row.get('history', []), {'at': iso(now()), 'event': event, 'message': message}]


def detail(row):
    correction = row.get('correction')
    return {'id': str(row['id']), 'sku': row['sku'], 'productId': str(row['product_id']) if row['product_id'] else None,
            'productName': row['product_name'], 'marketplaceId': row['marketplace_id'],
            'marketplaceName': MARKETS.get(row['marketplace_id'], row['marketplace_id']),
            'code': row['code'], 'message': row['message'], 'severity': row['severity'],
            'attributeNames': row['attribute_names'], 'status': row['status'], 'revision': row['revision'],
            'firstSeenAt': iso(row['first_seen_at']), 'lastSeenAt': iso(row['last_seen_at']),
            'lastCheckedAt': iso(row['last_checked_at']), 'resolvedAt': iso(row['resolved_at']),
            'history': row['history'], 'submissionStatus': row.get('submission_status'),
            'submissionIssues': row.get('submission_issues', []),
            'supportRequired': not bool(row['attribute_names']),
            'correction': {k: correction[k] for k in ('attributes', 'preparedAt', 'schemaHash')} if correction else None}


def get(connection, user_id, incident_id, lock=False):
    # Joining the current seller connection prevents exposing stale incidents after switching seller.
    row = connection.execute('''SELECT i.* FROM amazon_incidents i LEFT JOIN amazon_connections a
        ON a.user_id=i.user_id WHERE i.user_id=%s AND i.id::text=%s
        AND (a.seller_id IS NULL OR a.seller_id=i.seller_id)'''
        + (' FOR UPDATE OF i' if lock else ''), (user_id, str(incident_id))).fetchone()
    if not row:
        fail('incident_not_found', 'Esta incidencia no está disponible en tu cuenta conectada.', 404)
    return row


def lock_account(connection, user_id, seller, market):
    connection.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',
                       (str(user_id) + ':' + seller + ':' + market,))


def summary(item, market):
    return next((x for x in item.get('summaries', []) if x.get('marketplaceId') == market), {})


def product_type(item, market):
    return next((x.get('productType') for x in item.get('productTypes', []) if x.get('marketplaceId') == market),
                summary(item, market).get('productType'))


def updated(item, market):
    try:
        result = datetime.fromisoformat(summary(item, market).get('lastUpdatedDate', '').replace('Z', '+00:00'))
        return result if result.tzinfo else None
    except (ValueError, TypeError):
        return None


def snapshot(connection, user_id, seller, market, item, started, scan_id=None):
    key = (user_id, seller, market, item['sku'])
    previous = connection.execute('''SELECT * FROM amazon_listing_snapshots
        WHERE user_id=%s AND seller_id=%s AND marketplace_id=%s AND sku=%s FOR UPDATE''', key).fetchone()
    upstream = updated(item, market)
    if previous and (previous['fetched_at'] > started or previous['upstream_updated_at'] and
                     upstream and previous['upstream_updated_at'] > upstream):
        return None
    return connection.execute('''INSERT INTO amazon_listing_snapshots
        (user_id,seller_id,marketplace_id,sku,data,fetched_at,upstream_updated_at,scan_id)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(user_id,seller_id,marketplace_id,sku)
        DO UPDATE SET data=EXCLUDED.data,fetched_at=EXCLUDED.fetched_at,
        upstream_updated_at=EXCLUDED.upstream_updated_at,scan_id=EXCLUDED.scan_id,
        version=amazon_listing_snapshots.version+1 RETURNING *''',
        (*key, Jsonb(item), started, upstream, scan_id)).fetchone()


def observe(connection, user_id, seller, market, snap, reconcile=False):
    item, checked = snap['data'], snap['fetched_at']
    key = (user_id, seller, market, item['sku'])
    local = connection.execute('''SELECT id FROM products WHERE user_id=%s AND sku=%s
        AND deleted_at IS NULL''', (user_id, item['sku'])).fetchone()
    name = summary(item, market).get('itemName') or item['sku']
    seen = set()
    for issue in item['issues']:
        identity = issue_key(issue)
        if identity in seen:
            continue
        seen.add(identity)
        row = connection.execute('''SELECT * FROM amazon_incidents WHERE user_id=%s AND seller_id=%s
            AND marketplace_id=%s AND sku=%s AND issue_key=%s FOR UPDATE''', (*key, identity)).fetchone()
        if not row:
            connection.execute('''INSERT INTO amazon_incidents
                (id,user_id,seller_id,marketplace_id,sku,issue_key,code,message,severity,attribute_names,
                 raw_issue,product_name,product_type,product_id,last_checked_at,history)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
                (uuid4(), *key, identity, issue['code'], issue['message'], issue.get('severity', 'INFO'),
                 Jsonb(attrs(issue)), Jsonb(issue), name, product_type(item, market), local['id'] if local else None,
                 checked, Jsonb([{'at': iso(checked), 'event': 'detected', 'message': 'Amazon informa de esta incidencia.'}])))
        else:
            reopened = row['status'] == 'resolved'
            changed = row['message'] != issue['message'] or row['severity'] != issue.get('severity', 'INFO') or reopened
            events = history(row, 'reopened', 'Amazon vuelve a informar de esta incidencia.') if reopened else row['history']
            connection.execute('''UPDATE amazon_incidents SET message=%s,severity=%s,raw_issue=%s,
                product_name=%s,product_type=%s,product_id=%s,last_seen_at=%s,last_checked_at=%s,
                revision=revision+%s,status=%s,resolved_at=%s,history=%s WHERE id=%s''',
                (issue['message'], issue.get('severity', 'INFO'), Jsonb(issue), name, product_type(item, market),
                 local['id'] if local else None, checked, checked, int(changed),
                 'needs_attention' if reopened else row['status'], None if reopened else row['resolved_at'], Jsonb(events), row['id']))
    if reconcile:
        reconcile_snapshot(connection, key, snap, seen)


def expected_applied(expected, attributes):
    def canonical(value):
        if isinstance(value, dict):
            return {k: canonical(v) for k, v in sorted(value.items())}
        if isinstance(value, list):
            return sorted((canonical(v) for v in value), key=lambda v: json.dumps(v, sort_keys=True))
        return value
    # Order within an Amazon attribute collection is not material; value/unit/selector equality is.
    return bool(expected) and all(canonical(attributes.get(k)) == canonical(v) for k, v in expected.items())


def reconcile_snapshot(connection, key, snap, seen):
    rows = connection.execute('''SELECT * FROM amazon_incidents WHERE user_id=%s AND seller_id=%s
        AND marketplace_id=%s AND sku=%s AND status!='resolved' FOR UPDATE''', key).fetchall()
    for row in rows:
        present = row['issue_key'] in seen
        state, explanation, event = row['status'], None, None
        if state == 'awaiting_amazon':
            submission = connection.execute('''SELECT * FROM amazon_incident_submissions WHERE incident_id=%s
                ORDER BY sent_at DESC LIMIT 1 FOR UPDATE''', (row['id'],)).fetchone()
            if not submission:
                continue
            upstream = snap['upstream_updated_at']
            # ACCEPTED, elapsed time and absence alone do not prove application.
            applied = (snap['fetched_at'] > submission['sent_at'] and upstream is not None
                       and upstream > submission['sent_at']
                       and (not submission['baseline_updated_at'] or upstream > submission['baseline_updated_at'])
                       and expected_applied(submission['attributes'], snap['data']['attributes']))
            if not applied:
                continue
            state = 'needs_attention' if present else 'resolved'
            event = 'correction_required' if present else 'resolved'
            explanation = ('Amazon refleja los atributos enviados, pero sigue informando de la incidencia.' if present else
                           'Amazon refleja los atributos enviados y ya no informa de esta incidencia.')
            connection.execute('UPDATE amazon_incident_submissions SET status=%s WHERE id=%s',
                               ('needs_attention' if present else 'confirmed', submission['id']))
        elif not present:
            state, event = 'resolved', 'resolved'
            explanation = 'La consulta completa y actualizada a Amazon ya no informa de esta incidencia.'
        if explanation:
            connection.execute('''UPDATE amazon_incidents SET status=%s,revision=revision+1,resolved_at=%s,
                last_checked_at=%s,history=%s,correction=CASE WHEN %s='needs_attention' THEN NULL ELSE correction END
                WHERE id=%s''', (state, now() if state == 'resolved' else None, snap['fetched_at'],
                                Jsonb(history(row, event, explanation)), state, row['id']))


def replay(connection, user_id, request_id, operation, incident_id, data):
    if not isinstance(request_id, str) or not 8 <= len(request_id) <= 128:
        fail('invalid_request_id', 'La petición necesita un identificador válido.')
    digest = fingerprint(data)
    old = connection.execute('SELECT * FROM amazon_incident_requests WHERE user_id=%s AND request_id=%s FOR UPDATE',
                             (user_id, request_id)).fetchone()
    if old:
        if old['operation'] != operation or str(old['incident_id']) != str(incident_id) or old['fingerprint'] != digest:
            fail('request_conflict', 'Esta petición ya se utilizó con otros datos.', 409)
        return old, digest
    return None, digest
