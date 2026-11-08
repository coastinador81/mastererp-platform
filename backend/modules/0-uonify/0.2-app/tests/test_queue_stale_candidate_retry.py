"""A stale account snapshot must not send a busy worker to sleep with work queued."""

from contextlib import contextmanager
from uuid import uuid4

import pytest
from psycopg.types.json import Jsonb

from app.product_materials_queue import MaterialsQueue
from app.product_reasoning_queue import ReasoningQueue
from app.uony_conversation_queue import ConversationQueue


def seed(database, kind):
    database.migrate()
    users = []
    with database.connect() as c:
        for index in range(9):
            user_id, job_id, product_id = uuid4(), uuid4(), uuid4()
            subject = f'stale-{kind}-{index}-{user_id.hex}'
            users.append((user_id, job_id, product_id))
            c.execute('INSERT INTO users(id,google_subject,email) VALUES(%s,%s,%s)',
                      (user_id, subject, f'{index}@example.test'))
            if kind == 'conversation':
                c.execute("INSERT INTO uony_threads(user_id,id,title) VALUES(%s,'stale','Synthetic')",
                          (user_id,))
                c.execute("""INSERT INTO uony_requests(user_id,request_id,thread_id,prompt,
                    status,model,project_id) VALUES(%s,%s,'stale','Synthetic',
                    'running','fixture','fixture')""", (user_id, job_id))
                c.execute("""INSERT INTO uony_conversation_jobs(user_id,request_id,
                    thread_id,google_subject,project_id,payload,status,available_at)
                    VALUES(%s,%s,'stale',%s,'fixture',%s,'queued',
                        now()-make_interval(secs=>%s))""",
                    (user_id, job_id, subject, Jsonb({'text': 'synthetic'}), 30 if index == 0 else 0))
                continue
            c.execute("INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,%s,'{}')",
                      (user_id, product_id, product_id.hex))
            if kind == 'materials':
                c.execute("""INSERT INTO product_material_jobs(id,user_id,product_id,
                    request_id,google_subject,revision,folder_id,status,updated_at)
                    VALUES(%s,%s,%s,%s,%s,1,'fixture','queued',
                        now()-make_interval(secs=>%s))""",
                    (job_id, user_id, product_id, uuid4(), subject,
                     30 if index == 0 else 0))
            else:
                c.execute("""INSERT INTO product_reasoning_jobs(id,user_id,product_id,
                    google_subject,fingerprint,product_signature,schema_hash,status,
                    revision,context,updated_at)
                    VALUES(%s,%s,%s,%s,%s,'fixture','schema','queued',1,'{}',
                        now()-make_interval(secs=>%s))""",
                    (job_id, user_id, product_id, subject, job_id.hex,
                     30 if index == 0 else 0))
        if kind != 'conversation':
            first_user = users[0][0]
            product_id, job_id = uuid4(), uuid4()
            c.execute("INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,%s,'{}')",
                      (first_user, product_id, product_id.hex))
            if kind == 'materials':
                c.execute("""INSERT INTO product_material_jobs(id,user_id,product_id,
                    request_id,google_subject,revision,folder_id,status)
                    VALUES(%s,%s,%s,%s,'fixture',1,'fixture','queued')""",
                    (job_id, first_user, product_id, uuid4()))
            else:
                c.execute("""INSERT INTO product_reasoning_jobs(id,user_id,product_id,
                    google_subject,fingerprint,product_signature,schema_hash,status,
                    revision,context) VALUES(%s,%s,%s,'fixture',%s,'fixture',
                    'schema','queued',1,'{}')""",
                    (job_id, first_user, product_id, job_id.hex))
    return users


@pytest.mark.parametrize('kind', ['conversation', 'materials', 'reasoning'])
def test_stale_account_selection_retries_other_account_without_worker_sleep(environment, kind):
    _, _, database = environment
    users = seed(database, kind)
    table = {'conversation': 'uony_conversation_jobs',
             'materials': 'product_material_jobs',
             'reasoning': 'product_reasoning_jobs'}[kind]
    first_user, first_job, _ = users[0]
    injected = []

    class RacingConnection:
        def __init__(self, connection):
            self.connection = connection

        def execute(self, sql, params=()):
            result = self.connection.execute(sql, params)
            if (('JOIN LATERAL' in sql or
                 (kind == 'conversation' and
                  'FROM uony_conversation_jobs j' in sql and
                  'JOIN users u ON u.id=j.user_id' in sql)) and
                    'FOR NO KEY UPDATE OF u SKIP LOCKED' in sql and not injected):
                injected.append(True)
                with database.connect() as other:
                    other.execute(f"""UPDATE {table} SET status='running',
                        lease_until=now()+interval '2 minutes'
                        WHERE user_id=%s AND """ +
                        ('request_id=%s' if kind == 'conversation' else 'id=%s'),
                        (first_user, first_job))
            return result

    class RacingDatabase:
        @contextmanager
        def connect(self):
            with database.connect() as connection:
                yield RacingConnection(connection)

    queue_type = {'conversation': ConversationQueue,
                  'materials': MaterialsQueue,
                  'reasoning': ReasoningQueue}[kind]
    row = queue_type(RacingDatabase()).claim('synthetic-worker')
    assert injected == [True]
    assert row and row['user_id'] in {item[0] for item in users[1:]}
    with database.connect() as c:
        assert c.execute(f"SELECT status FROM {table} WHERE user_id=%s AND " +
                         ('request_id=%s' if kind == 'conversation' else 'id=%s'),
                         (first_user, first_job)).fetchone()['status'] == 'running'
