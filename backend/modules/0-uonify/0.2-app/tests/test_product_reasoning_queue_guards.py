"""La continuidad no elude un intento incierto que aparece después de encolarla."""
from uuid import uuid4
import pytest
from app.product_materials_queue import BudgetPause
from test_product_reasoning_jobs import reasoning_env, prepare  # noqa: F401
from test_product_requirements import requirement_env  # noqa: F401


def test_expired_prior_call_blocks_a_new_job_before_reserving_any_more_usage(reasoning_env):
    _, db, service, _, *_ = reasoning_env
    prepare(reasoning_env)
    original = service.queue.claim('first-worker')
    first_call = service.queue.reserve(original, 'propose:first', 100)
    child_id = uuid4()
    with db.connect() as c:
        c.execute('''INSERT INTO product_reasoning_jobs(id,user_id,product_id,material_job_id,
            google_subject,fingerprint,product_signature,schema_hash,status,revision,context)
            SELECT %s,user_id,product_id,material_job_id,google_subject,%s,product_signature,
                schema_hash,'queued',revision,context FROM product_reasoning_jobs WHERE id=%s''',
            (child_id, uuid4().hex, original['id']))
        c.execute("UPDATE product_reasoning_jobs SET lease_until=now()-interval '1 second' WHERE id=%s",
                  (original['id'],))
    child = service.queue.claim('second-worker', child_id)
    assert child and child['id'] == child_id
    with pytest.raises(BudgetPause) as caught:
        service.queue.reserve(child, 'propose:new-target', 100)
    assert caught.value.reason == 'consumption_unknown'
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM product_reasoning_calls WHERE job_id=%s',
                          (child_id,)).fetchone()['n'] == 0
        old = c.execute('SELECT state,acknowledged_at FROM product_reasoning_calls WHERE id=%s',
                        (first_call,)).fetchone()
        assert old['state'] == 'unknown' and old['acknowledged_at'] is None
        # La aceptación se comprueba por la ruta HTTP en la suite de continuidad.
        # Aquí solo se ejercita la guarda de reserva después del cambio concurrente.
        c.execute('UPDATE product_reasoning_calls SET acknowledged_at=now() WHERE id=%s', (first_call,))
    assert service.queue.reserve(child, 'propose:new-target', 100)
