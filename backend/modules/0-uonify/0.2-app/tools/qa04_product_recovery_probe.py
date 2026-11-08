"""Measure material/reasoning lease recovery in a disposable PostgreSQL schema.

No HTTP or provider calls. Run from the backend image with this script mounted
at /app/tools. The output describes this local host, not production capacity.
"""
import argparse
from dataclasses import replace
from datetime import datetime, timezone
import json
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from psycopg import sql
from psycopg.types.json import Jsonb

from app.database import Database
from app.product_materials_queue import MaterialsQueue
from app.product_reasoning_queue import ReasoningQueue
from app.settings import load_settings


def apply_migrations(database):
    paths = Path(__file__).resolve().parents[1] / 'migrations'
    with database.connect() as c:
        for path in sorted(paths.glob('*.sql')):
            if int(path.name[:3]) <= 64:
                c.execute(path.read_text())


def seed(database, accounts, expired):
    rows = [(uuid4(), uuid4(), uuid4(), uuid4(), index)
            for index in range(accounts)]
    with database.connect() as c:
        with c.cursor() as cur:
            cur.executemany('INSERT INTO users(id,google_subject,email) VALUES(%s,%s,%s)',
                            [(user, f'qa04-{index}', f'qa04-{index}@example.test')
                             for user, _, _, _, index in rows])
            cur.executemany("INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,%s,'{}')",
                            [(user, product, product.hex) for user, product, _, _, _ in rows])
            cur.executemany("""INSERT INTO product_material_jobs(id,user_id,product_id,
                request_id,google_subject,revision,folder_id,status,lease_token,lease_until)
                VALUES(%s,%s,%s,%s,'synthetic',1,'synthetic',%s,%s,%s)""",
                [(material, user, product, uuid4(),
                  'running' if index < expired else 'ready', uuid4() if index < expired else None,
                  None if index % 2 == 0 else datetime(2020, 1, 1, tzinfo=timezone.utc))
                 for user, product, material, _, index in rows])
            cur.executemany("""INSERT INTO product_reasoning_jobs(id,user_id,product_id,
                google_subject,fingerprint,product_signature,schema_hash,status,
                revision,context,lease_token,lease_until)
                VALUES(%s,%s,%s,'synthetic',%s,'synthetic','schema',%s,1,'{}',%s,%s)""",
                [(reasoning, user, product, reasoning.hex,
                  'running' if index < expired else 'completed',
                  uuid4() if index < expired else None,
                  None if index % 2 == 0 else datetime(2020, 1, 1, tzinfo=timezone.utc))
                 for user, product, _, reasoning, index in rows])
        # Simulate one started call in each queue. Recovery must not replay it.
        c.execute("""INSERT INTO product_material_calls(id,job_id,lease_token,
            fragment_ids,state,reserved_tokens) SELECT %s,id,lease_token,%s,
            'running',100 FROM product_material_jobs WHERE id=%s""",
            (uuid4(), Jsonb(['synthetic']), rows[0][2]))
        c.execute("""INSERT INTO product_reasoning_calls(id,job_id,lease_token,
            phase,state,reserved_tokens) SELECT %s,id,lease_token,'propose',
            'running',100 FROM product_reasoning_jobs WHERE id=%s""",
            (uuid4(), rows[0][3]))
        c.execute('ANALYZE users')
        c.execute('ANALYZE product_material_jobs')
        c.execute('ANALYZE product_reasoning_jobs')
    return rows


def nodes(node):
    found = [node['Node Type'] +
             (':' + node['Index Name'] if node.get('Index Name') else '')]
    return found + [item for child in node.get('Plans', []) for item in nodes(child)]


def inspect_plan(database, table):
    with database.connect() as c:
        plan = c.execute(f"""EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
            SELECT j.id,j.user_id FROM {table} j JOIN users u ON u.id=j.user_id
            WHERE j.status='running'
            AND coalesce(j.lease_until,'-infinity'::timestamptz)<=now()
            AND u.deletion_requested_at IS NULL
            ORDER BY coalesce(j.lease_until,'-infinity'::timestamptz),j.user_id,j.id
            FOR NO KEY UPDATE OF u SKIP LOCKED LIMIT 64""").fetchone()['QUERY PLAN'][0]
    return {'executionMs': round(plan['Execution Time'], 3),
            'sharedHitBlocks': plan['Plan'].get('Shared Hit Blocks'),
            'nodes': nodes(plan['Plan'])}


def drain(database, kind, expired, first_job):
    queue = MaterialsQueue(database) if kind == 'materials' else ReasoningQueue(database)
    table = 'product_material_jobs' if kind == 'materials' else 'product_reasoning_jobs'
    plan = inspect_plan(database, table)
    batches, durations = [], []
    while True:
        start = perf_counter()
        recovered = queue.recover()
        durations.append(round((perf_counter() - start) * 1000, 3))
        if not recovered:
            break
        batches.append(recovered)
    with database.connect() as c:
        statuses = {r['status']: r['n'] for r in c.execute(
            f'SELECT status,count(*) AS n FROM {table} GROUP BY status').fetchall()}
        call_table = 'product_material_calls' if kind == 'materials' else 'product_reasoning_calls'
        call = c.execute(f'SELECT state,acknowledged_at FROM {call_table} WHERE job_id=%s',
                         (first_job,)).fetchone()
        first = c.execute(f'SELECT status FROM {table} WHERE id=%s', (first_job,)).fetchone()
    assert sum(batches) == expired and max(batches) <= 64 and len(batches) == (expired + 63) // 64
    assert call['state'] == 'unknown' and call['acknowledged_at'] is None
    assert first['status'] == ('paused' if kind == 'materials' else 'unknown')
    assert queue.claim('qa04-no-replay', first_job) is None
    return {'candidatePlan': plan, 'batchCounts': batches,
            'batchMs': {'median': sorted(durations)[len(durations) // 2],
                        'max': max(durations)},
            'statuses': statuses, 'startedCall': 'unknown_without_replay'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--accounts', type=int, default=10000)
    parser.add_argument('--expired', type=int, default=1000)
    args = parser.parse_args()
    if not 2 <= args.expired <= args.accounts <= 100000:
        parser.error('Use 2 <= expired <= accounts <= 100000')
    settings = load_settings()
    admin = Database(settings.database)
    schema = 'qa04_product_' + uuid4().hex
    with admin.connect() as c:
        c.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
    database = Database({**settings.database, 'options': '-csearch_path=' + schema})
    try:
        apply_migrations(database)
        seeded_at = perf_counter()
        rows = seed(database, args.accounts, args.expired)
        seed_seconds = round(perf_counter() - seeded_at, 3)
        result = {'kind': 'synthetic_postgresql_only', 'utc': datetime.now(timezone.utc).isoformat(),
                  'accounts': args.accounts, 'expiredPerQueue': args.expired,
                  'seedSeconds': seed_seconds,
                  'materials': drain(database, 'materials', args.expired, rows[0][2]),
                  'reasoning': drain(database, 'reasoning', args.expired, rows[0][3]),
                  'limits': ['No provider, HTTP or end-to-end latency',
                             'No production load or capacity claim']}
        print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        with admin.connect() as c:
            c.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))


if __name__ == '__main__':
    main()
