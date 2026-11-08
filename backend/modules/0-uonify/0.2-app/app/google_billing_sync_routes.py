"""Explicit, authenticated initiation and continuation of Google cost consultation."""
from fastapi import APIRouter, Request
from .google_billing_sync import GoogleBillingSync, failure
from .onboarding import StrictBody, require_user
from .security import require_origin


class SyncBody(StrictBody):
    prepare: bool = False


def routes(settings, database, cloud, reports=None):
    router = APIRouter(prefix='/api/uony')
    service = GoogleBillingSync(settings, database, cloud, reports)

    @router.post('/google-billing/sync')
    def sync(body: SyncBody, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as connection:
            user = require_user(connection, request)
            user_id = user['id']
        def guard(connection, current):
            authenticated = require_user(connection, request)
            if authenticated['id'] != current['id']:
                raise failure('connection_changed')
        result = service.sync(user_id, body.prepare, guard)
        return {'accountEmail': user['email'], 'projectId': result['projectId'],
                'billingAccountName': result['billingAccountName'], 'sync': result}

    return router
