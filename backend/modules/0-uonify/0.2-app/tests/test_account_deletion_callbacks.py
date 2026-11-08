"""Un OAuth tardío no restaura una conexión de una cuenta en eliminación."""
from app.amazon_store import record_error
from test_amazon_oauth import clients, ready, start, callback


def test_amazon_pending_callback_stops_before_exchange_without_mutating_attempt(environment):
    _, google, db = environment
    with clients(environment) as (local, gateway, amazon):
        ready(local, google, db)
        _, state, _ = start(local, gateway)
        with db.connect() as connection:
            connection.execute('UPDATE users SET deletion_requested_at=now()')
            before = connection.execute('SELECT * FROM amazon_oauth_attempts').fetchone()
        result = callback(gateway, state)
        assert result.status_code == 400
        assert 'No se ha completado la conexión' in result.text
        assert not amazon.calls
        record_error(db, before['id'], 'session_or_subscription')
        with db.connect() as connection:
            assert connection.execute('SELECT * FROM amazon_oauth_attempts').fetchone() == before
            assert connection.execute('SELECT count(*) AS n FROM amazon_connections').fetchone()['n'] == 0
