"""Endpoint de recuperación de preparación creativa, sin efectos externos."""

from fastapi import APIRouter, Request

from .creative_preparation_service import get_creative_preparation
from .onboarding import require_user
from .products import require_access


def routes(database):
    router = APIRouter(prefix='/api/uony/threads/{thread_id}')

    @router.get('/creative-preparation')
    def preparation(thread_id: str, request: Request):
        with database.connect() as connection:
            user = require_user(connection, request)
            require_access(connection, user)
            return {'creativePreparation': get_creative_preparation(
                connection, user, thread_id)}

    return router
