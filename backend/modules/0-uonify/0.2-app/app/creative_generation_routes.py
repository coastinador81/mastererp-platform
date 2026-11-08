"""Read an internally issued quote and acknowledge its exact spend ceiling.

There is deliberately no HTTP endpoint to issue a quote or reserve a provider
attempt. The approved UI is unchanged until its separate visual review.
"""
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Request
from pydantic import Field

from .creative_generation_ledger import approve_exact, get_approval, get_quote
from .onboarding import StrictBody, require_user
from .security import require_origin


class ApproveCreativeQuote(StrictBody):
    requestId: UUID = Field(strict=False)
    quoteId: UUID = Field(strict=False)
    quoteSha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    planRevision: int = Field(gt=0)
    planSha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    requestSha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    maxTotalUsd: Decimal = Field(strict=False, gt=0, max_digits=12,
                                 decimal_places=2)
    acknowledgeExactMaximum: bool


def routes(settings, database):
    router = APIRouter(prefix='/api/uony/threads/{thread_id}/creative-generation')

    @router.get('/quotes/{quote_id}')
    def quote(thread_id: str, quote_id: UUID, request: Request):
        with database.connect() as c:
            return get_quote(c, require_user(c, request), thread_id, quote_id)

    @router.post('/approvals')
    def approve(thread_id: str, body: ApproveCreativeQuote, request: Request):
        require_origin(request, settings.origin)
        with database.connect() as c:
            return approve_exact(c, require_user(c, request), thread_id,
                                 body.quoteId, body.requestId, body.quoteSha256,
                                 body.planRevision, body.planSha256,
                                 body.requestSha256, body.maxTotalUsd,
                                 body.acknowledgeExactMaximum)

    @router.get('/approvals/{approval_id}')
    def approval(thread_id: str, approval_id: UUID, request: Request):
        with database.connect() as c:
            return get_approval(c, require_user(c, request), thread_id,
                                approval_id)

    return router
