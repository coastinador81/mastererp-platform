"""Pure order state rules migrated from Tu Mandadito.

This module deliberately has no HTTP, AWS or database dependency. It is the
single backend vocabulary for order states while persistence and adapters are
migrated incrementally.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


LEGACY_PREPARED_STATUS = "PREPARED"


class StringEnum(str, Enum):
    """Python 3.10-compatible string enum with stable string conversion."""

    def __str__(self) -> str:
        return self.value


class OrderStatus(StringEnum):
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    PREPARING = "PREPARING"
    READY = "READY"
    OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY"
    DELIVERED = "DELIVERED"
    CANCELLED = "CANCELLED"


class PaymentMethod(StringEnum):
    MOBILE_PAYMENT = "mobile_payment"
    BANK_TRANSFER = "bank_transfer"
    CASH = "cash"
    POINT_OF_SALE = "pos"
    CUSTOM = "custom"


class PaymentStatus(StringEnum):
    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    VALIDATED = "VALIDATED"
    REJECTED = "REJECTED"
    PENDING_COLLECTION = "PENDING_COLLECTION"


class TransitionOwner(StringEnum):
    ORDERS = "orders"
    PREPARATION = "preparation"
    ROUTES = "routes"
    DELIVERY = "delivery"


@dataclass(frozen=True, slots=True)
class TransitionRule:
    owner: TransitionOwner
    requires_payment_ready: bool = False


TRANSITIONS: dict[tuple[OrderStatus, OrderStatus], TransitionRule] = {
    (OrderStatus.PENDING, OrderStatus.CONFIRMED): TransitionRule(
        TransitionOwner.ORDERS,
        requires_payment_ready=True,
    ),
    (OrderStatus.PENDING, OrderStatus.CANCELLED): TransitionRule(TransitionOwner.ORDERS),
    (OrderStatus.CONFIRMED, OrderStatus.PREPARING): TransitionRule(TransitionOwner.PREPARATION),
    (OrderStatus.CONFIRMED, OrderStatus.CANCELLED): TransitionRule(TransitionOwner.ORDERS),
    (OrderStatus.PREPARING, OrderStatus.READY): TransitionRule(TransitionOwner.PREPARATION),
    (OrderStatus.PREPARING, OrderStatus.CANCELLED): TransitionRule(TransitionOwner.ORDERS),
    (OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY): TransitionRule(TransitionOwner.ROUTES),
    (OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED): TransitionRule(TransitionOwner.DELIVERY),
}


class InvalidOrderTransition(ValueError):
    """A caller requested a transition outside the published order contract."""

    def __init__(self, current: OrderStatus, requested: OrderStatus, reason: str) -> None:
        super().__init__(reason)
        self.current = current
        self.requested = requested
        self.code = "INVALID_TRANSITION"


def canonical_order_status(value: str | OrderStatus) -> OrderStatus:
    """Parse a persisted status, normalizing the read-only legacy alias."""

    normalized = str(value).strip().upper()
    if normalized == LEGACY_PREPARED_STATUS:
        return OrderStatus.READY
    try:
        return OrderStatus(normalized)
    except ValueError as error:
        raise ValueError("Unsupported order status") from error


def payment_allows_operational_progress(
    method: str | PaymentMethod,
    status: str | PaymentStatus,
) -> bool:
    """Return whether payment state permits PENDING -> CONFIRMED.

    Cash is collected later and may progress. Electronic methods require an
    explicit validation. Unknown values fail closed.
    """

    try:
        parsed_method = PaymentMethod(str(method))
        parsed_status = PaymentStatus(str(status))
    except ValueError:
        return False
    if parsed_method in (PaymentMethod.CASH, PaymentMethod.POINT_OF_SALE):
        return parsed_status is PaymentStatus.PENDING_COLLECTION
    return parsed_status is PaymentStatus.VALIDATED


def ensure_transition(
    current: str | OrderStatus,
    requested: str | OrderStatus,
    *,
    owner: str | TransitionOwner,
    payment_method: str | PaymentMethod | None = None,
    payment_status: str | PaymentStatus | None = None,
) -> TransitionRule:
    """Validate one order transition and return its governing rule.

    Same-state requests are idempotent only for canonical persisted states.
    They do not grant another module ownership of a transition.
    """

    parsed_current = canonical_order_status(current)
    parsed_requested = canonical_order_status(requested)
    try:
        parsed_owner = TransitionOwner(str(owner))
    except ValueError as error:
        raise InvalidOrderTransition(parsed_current, parsed_requested, "Unknown transition owner") from error

    if parsed_current is parsed_requested:
        return TransitionRule(parsed_owner)

    rule = TRANSITIONS.get((parsed_current, parsed_requested))
    if rule is None:
        raise InvalidOrderTransition(
            parsed_current,
            parsed_requested,
            f"Transition not allowed: {parsed_current.value} -> {parsed_requested.value}",
        )
    if rule.owner is not parsed_owner:
        raise InvalidOrderTransition(
            parsed_current,
            parsed_requested,
            f"Transition belongs to {rule.owner.value}",
        )
    if rule.requires_payment_ready and (
        payment_method is None
        or payment_status is None
        or not payment_allows_operational_progress(payment_method, payment_status)
    ):
        raise InvalidOrderTransition(
            parsed_current,
            parsed_requested,
            "Payment is not ready for operational progress",
        )
    return rule
