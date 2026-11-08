"""Un conector pendiente de eliminación no reclama trabajo ni modifica métricas."""
from conftest import client_for
from test_blender_local import native, pair, POLL
from test_uony import ready


def test_deleting_account_rejects_native_poll_before_any_write(environment):
    config, google, db = environment
    with client_for(config, google) as client:
        ready(client, google, db)
        token = pair(client)
        with db.connect() as connection:
            agent = connection.execute('SELECT * FROM blender_agents').fetchone()
            usage = connection.execute('SELECT * FROM blender_coordination_usage ORDER BY id').fetchall()
            connection.execute('UPDATE users SET deletion_requested_at=now()')
        result = native(client, 'poll', POLL, token)
        assert result.status_code == 401 and result.json()['error'] == 'blender_agent_revoked'
        with db.connect() as connection:
            assert connection.execute('SELECT * FROM blender_agents').fetchone() == agent
            assert connection.execute('SELECT * FROM blender_coordination_usage ORDER BY id').fetchall() == usage
            assert connection.execute('SELECT count(*) AS n FROM blender_jobs').fetchone()['n'] == 0
