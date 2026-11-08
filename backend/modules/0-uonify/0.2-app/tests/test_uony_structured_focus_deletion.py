"""Structured focus receipts respect the account-deletion write barrier."""
from uuid import uuid4

import pytest
from psycopg.errors import ObjectNotInPrerequisiteState


def test_structured_focus_receipt_blocks_writes_for_deleting_account(environment):
    _, _, db = environment
    db.migrate()
    deleting, active = uuid4(), uuid4()
    saved = uuid4()
    with db.connect() as c:
        for owner in (deleting, active):
            c.execute('''INSERT INTO users(id,google_subject,email,display_name)
                VALUES(%s,%s,%s,'Fixture')''',
                (owner, 'subject-' + owner.hex, owner.hex + '@example.test'))
            c.execute('''INSERT INTO uony_threads(user_id,id,title)
                VALUES(%s,'chat','Chat')''', (owner,))
        c.execute('''INSERT INTO uony_structured_focus_expectations
            (user_id,request_id,thread_id,google_subject,focus_version)
            VALUES(%s,%s,'chat',%s,0)''',
            (deleting, saved, 'subject-' + deleting.hex))
        c.execute('UPDATE users SET deletion_requested_at=now() WHERE id=%s',
                  (deleting,))

    with pytest.raises(ObjectNotInPrerequisiteState):
        with db.connect() as c:
            c.execute('''INSERT INTO uony_structured_focus_expectations
                (user_id,request_id,thread_id,google_subject,focus_version)
                VALUES(%s,%s,'chat',%s,0)''',
                (deleting, uuid4(), 'subject-' + deleting.hex))
    with pytest.raises(ObjectNotInPrerequisiteState):
        with db.connect() as c:
            c.execute('''UPDATE uony_structured_focus_expectations
                SET focus_version=0 WHERE user_id=%s AND request_id=%s''',
                (deleting, saved))

    with db.connect() as c:
        c.execute('''INSERT INTO uony_structured_focus_expectations
            (user_id,request_id,thread_id,google_subject,focus_version)
            VALUES(%s,%s,'chat',%s,0)''',
            (active, uuid4(), 'subject-' + active.hex))
        assert c.execute('''SELECT count(*) n FROM uony_structured_focus_expectations
            WHERE user_id=%s''', (deleting,)).fetchone()['n'] == 1
