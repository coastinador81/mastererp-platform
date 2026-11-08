"""Derecho de acceso: solo periodos verificados, nunca saldo externo ni estado del navegador."""
from fastapi import APIRouter, Request
from .onboarding import require_user, onboarding_state


def workspace_access(connection, user):
    if onboarding_state(connection, user)['onboarding']['step'] != 'pending':
        return {'status': 'onboarding_required'}
    period = connection.execute('''SELECT kind, ends_at FROM access_periods
        WHERE user_id=%s AND revoked_at IS NULL AND starts_at<=now() AND ends_at>now()
        ORDER BY ends_at DESC LIMIT 1''', (user['id'],)).fetchone()
    if not period:
        return {'status': 'subscription_required'}
    return {'status': 'allowed', 'basis': period['kind'], 'endsAt': period['ends_at'].isoformat()}


def routes(database):
    router = APIRouter(prefix='/api/billing')

    @router.get('/workspace-access')
    def access(request: Request):
        with database.connect() as connection:
            user = require_user(connection, request)
            return workspace_access(connection, user)

    return router
