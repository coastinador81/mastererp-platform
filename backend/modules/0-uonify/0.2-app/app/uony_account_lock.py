"""Account (owner) row lock with a short first wait and a diagnosed, bounded patience.

Every writer of an account serializes on its ``users`` row. The Live voice path
waited only 200 ms for it, so an unrelated short transaction of the same account
turned a spoken turn into «No pude interpretar… fallo técnico» (20-10-2026,
lock timeouts at 01:09:31, 01:10:03 and 01:10:34 UTC). Waiting a little longer,
inside the turn's own deadline, absorbs ordinary contention. Whenever contention
appears, a sanitized snapshot of the open transactions names the holder.
"""
import json
import logging
import time

from psycopg import errors

logger = logging.getLogger(__name__)
FIRST_WAIT_MS = 150
SNAPSHOT_STATEMENT_MS = 250
COLUMNS = {'*': 'SELECT * FROM users WHERE id=%s FOR UPDATE',
           'google_subject': 'SELECT google_subject FROM users WHERE id=%s FOR UPDATE'}


def open_transactions(database):
    """Other open transactions of this database, oldest first.

    Statement text keeps its $n placeholders (server-side binding), so no
    parameter value reaches the log. Never raises.
    """
    try:
        with database.connect() as c:
            c.execute(f"SET LOCAL statement_timeout = '{SNAPSHOT_STATEMENT_MS}ms'")
            rows = c.execute('''SELECT pid, state, wait_event_type AS wait,
                client_addr::text AS client,
                (extract(epoch FROM clock_timestamp() - xact_start) * 1000)::int AS xact_ms,
                left(regexp_replace(query, '\\s+', ' ', 'g'), 160) AS query
                FROM pg_stat_activity
                WHERE datname = current_database() AND pid <> pg_backend_pid()
                  AND xact_start IS NOT NULL
                ORDER BY xact_start LIMIT 8''').fetchall()
        return [dict(row) for row in rows]
    except Exception as error:
        return [{'unavailable': type(error).__name__}]


def _report(caller, outcome, started, holders):
    logger.warning('Account lock contention %s', json.dumps({
        'type': 'account_lock', 'caller': caller, 'outcome': outcome,
        'waitedMs': round((time.monotonic() - started) * 1000, 1),
        'holders': holders}, sort_keys=True, default=str))


def lock_account(c, database, user_id, *, caller, patience_ms, columns='*'):
    """``SELECT … FOR UPDATE`` on the owner row inside the caller's transaction.

    Tries for FIRST_WAIT_MS behind a savepoint, so a timeout does not abort the
    transaction; then records who holds the row and waits up to ``patience_ms``.
    Raises ``LockNotAvailable`` only after that bounded patience.
    """
    query = COLUMNS[columns]
    started = time.monotonic()
    # The caller's timeouts govern the rest of its transaction; restore them.
    previous = (c.execute('SHOW lock_timeout').fetchone()['lock_timeout'],
                c.execute('SHOW statement_timeout').fetchone()['statement_timeout'])

    def acquired(row):
        c.execute('RELEASE SAVEPOINT uony_account_lock')
        c.execute("SELECT set_config('lock_timeout', %s, true), "
                  "set_config('statement_timeout', %s, true)", previous)
        return row

    c.execute('SAVEPOINT uony_account_lock')
    c.execute(f"SET LOCAL lock_timeout = '{FIRST_WAIT_MS}ms'")
    try:
        return acquired(c.execute(query, (user_id,)).fetchone())
    except errors.LockNotAvailable:
        c.execute('ROLLBACK TO SAVEPOINT uony_account_lock')
    holders = open_transactions(database)
    patience = max(FIRST_WAIT_MS, int(patience_ms))
    c.execute(f"SET LOCAL lock_timeout = '{patience}ms'")
    c.execute(f"SET LOCAL statement_timeout = '{patience + 500}ms'")
    try:
        row = c.execute(query, (user_id,)).fetchone()
    except errors.LockNotAvailable:
        _report(caller, 'timeout', started, holders)
        raise
    _report(caller, 'acquired', started, holders)
    return acquired(row)
