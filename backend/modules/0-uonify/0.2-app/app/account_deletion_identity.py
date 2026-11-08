"""Minimal, pseudonymous trial history; never stores a Google token or email."""
import hashlib
import hmac
from uuid import UUID


def subject_hash(settings, user):
    key = settings.encryption_key
    if isinstance(key, str):
        key = key.encode()
    return hmac.new(key, ('uonify-deleted-trial-v1:' + user['google_subject']).encode(), hashlib.sha256).hexdigest()


def intent_id(settings, user, session_token):
    key = settings.encryption_key
    if isinstance(key, str):
        key = key.encode()
    value = ':'.join(('uonify-deletion-intent-v1', str(user['id']), user['google_subject'], session_token))
    # Opaque UUID, bound to this exact authenticated account/session without a
    # preflight database write. A different login cannot reuse a stale review.
    return UUID(bytes=hmac.new(key, value.encode(), hashlib.sha256).digest()[:16], version=4)


def trial_was_used(connection, settings, user):
    current = connection.execute('''SELECT 1 FROM billing_subscriptions WHERE user_id=%s AND trial_start IS NOT NULL
        UNION ALL SELECT 1 FROM access_periods WHERE user_id=%s AND kind='trial' LIMIT 1''',
        (user['id'], user['id'])).fetchone()
    row = connection.execute('SELECT trial_used FROM account_trial_history WHERE subject_hash=%s',
                             (subject_hash(settings, user),)).fetchone()
    return bool(current or (row and row['trial_used']))


def retain_trial(connection, settings, user, trial_used):
    connection.execute('''INSERT INTO account_trial_history(subject_hash,trial_used) VALUES (%s,%s)
        ON CONFLICT(subject_hash) DO UPDATE SET trial_used=account_trial_history.trial_used OR excluded.trial_used,
        deleted_at=now()''', (subject_hash(settings, user), bool(trial_used)))
