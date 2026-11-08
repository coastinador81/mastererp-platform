"""One worker must alternate accounts with waiting jobs instead of draining one backlog."""
from uuid import uuid4

import pytest

from app.product_materials_queue import MaterialsQueue
from app.product_reasoning_queue import ReasoningQueue
from test_account_deletion_queue import setup_jobs
from test_product_queue_account_cap import second_job


@pytest.mark.parametrize('kind', ['materials', 'reasoning'])
def test_single_worker_serves_waiting_account_before_draining_older_backlog(environment, kind):
    _, _, database = environment
    first_user, second_user, first_job, other_job, table, _ = setup_jobs(
        database, kind, 'queued', 'queued', deleting=False)
    second_for_first = second_job(database, kind, first_user)
    third_for_first = second_job(database, kind, first_user)
    with database.connect() as c:
        for job_id, minutes in ((first_job, 4), (second_for_first, 3),
                                (third_for_first, 2), (other_job, 1)):
            c.execute(f"UPDATE {table} SET updated_at=now()-make_interval(mins=>%s) WHERE id=%s",
                      (minutes, job_id))

    queue = MaterialsQueue(database) if kind == 'materials' else ReasoningQueue(database)
    expected = [first_job, other_job, second_for_first, third_for_first]
    claimed = []
    for index, expected_id in enumerate(expected):
        row = queue.claim(f'only-worker-{index}')
        assert row and row['id'] == expected_id
        claimed.append(row['user_id'])
        if kind == 'materials':
            queue.checkpoint(row['id'], row['user_id'], row['lease_token'], {'stage': 'ready'},
                             status='ready')
        else:
            queue.terminal(row, 'completed', {})

    assert claimed == [first_user, second_user, first_user, first_user]
    assert queue.claim('nothing-else') is None
