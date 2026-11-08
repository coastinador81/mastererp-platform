"""Backoff durable y presupuesto de polling para handles Google aceptados."""

from dataclasses import dataclass
from datetime import datetime, timedelta

from .creative_composite_quote import HASH, canonical_sha256


@dataclass(frozen=True)
class GooglePollPolicy:
    max_requests: int
    initial_seconds: int
    maximum_seconds: int
    approval_expires_at: datetime


@dataclass(frozen=True)
class GooglePollProgress:
    handoff_sha256: str
    completed_requests: int
    last_polled_at: datetime | None


@dataclass(frozen=True)
class GooglePollDeferral:
    snapshot: dict
    sha256: str
    next_available_at: datetime


def next_google_poll(
        policy: GooglePollPolicy, progress: GooglePollProgress, *,
        now: datetime) -> GooglePollDeferral:
    if (not isinstance(policy, GooglePollPolicy)
            or not isinstance(progress, GooglePollProgress)
            or not isinstance(now, datetime) or not now.tzinfo
            or not isinstance(policy.approval_expires_at, datetime)
            or not policy.approval_expires_at.tzinfo
            or not 1 <= policy.max_requests <= 10_000
            or not 1 <= policy.initial_seconds <= policy.maximum_seconds <= 900
            or not HASH.fullmatch(progress.handoff_sha256)
            or not isinstance(progress.completed_requests, int)
            or isinstance(progress.completed_requests, bool)
            or not 0 <= progress.completed_requests <= policy.max_requests
            or (progress.last_polled_at is not None
                and (not isinstance(progress.last_polled_at, datetime)
                     or not progress.last_polled_at.tzinfo))):
        raise ValueError("Política de polling Google no válida.")
    if now >= policy.approval_expires_at:
        raise ValueError("La aprobación Google venció durante el polling.")
    if progress.completed_requests >= policy.max_requests:
        raise ValueError("Se agotó el presupuesto de polling Google.")
    delay = min(
        policy.maximum_seconds,
        policy.initial_seconds * (2 ** min(progress.completed_requests, 10)))
    base = progress.last_polled_at or now
    next_at = max(now, base + timedelta(seconds=delay))
    if next_at >= policy.approval_expires_at:
        raise ValueError("El siguiente poll excede la aprobación Google.")
    snapshot = {
        "schemaVersion": 1, "kind": "google_poll_deferral",
        "handoffSha256": progress.handoff_sha256,
        "completedRequests": progress.completed_requests,
        "nextRequestOrdinal": progress.completed_requests + 1,
        "maxRequests": policy.max_requests,
        "delaySeconds": delay,
        "nextAvailableAt": next_at.isoformat(),
        "approvalExpiresAt": policy.approval_expires_at.isoformat(),
    }
    return GooglePollDeferral(snapshot, canonical_sha256(snapshot), next_at)
