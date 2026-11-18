"""Executable contract tests for the first migrated Orders slice."""

from pathlib import Path
import sys
import unittest


MODULE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE))

from orders_domain import (  # noqa: E402
    InvalidOrderTransition,
    OrderStatus,
    TransitionOwner,
    canonical_order_status,
    ensure_transition,
    payment_allows_operational_progress,
)


class OrdersDomainTests(unittest.TestCase):
    def test_legacy_prepared_is_read_as_ready(self):
        self.assertIs(canonical_order_status("PREPARED"), OrderStatus.READY)

    def test_unknown_status_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "Unsupported order status"):
            canonical_order_status("UNKNOWN")

    def test_cash_pending_collection_can_be_confirmed(self):
        self.assertTrue(payment_allows_operational_progress("cash", "PENDING_COLLECTION"))
        ensure_transition(
            "PENDING",
            "CONFIRMED",
            owner="orders",
            payment_method="cash",
            payment_status="PENDING_COLLECTION",
        )

    def test_point_of_sale_collects_like_cash_and_custom_requires_validation(self):
        self.assertTrue(payment_allows_operational_progress("pos", "PENDING_COLLECTION"))
        self.assertFalse(payment_allows_operational_progress("custom", "PENDING_VERIFICATION"))
        self.assertTrue(payment_allows_operational_progress("custom", "VALIDATED"))

    def test_electronic_payment_requires_validation(self):
        self.assertFalse(payment_allows_operational_progress("mobile_payment", "PENDING_VERIFICATION"))
        with self.assertRaisesRegex(InvalidOrderTransition, "Payment is not ready"):
            ensure_transition(
                "PENDING",
                "CONFIRMED",
                owner="orders",
                payment_method="mobile_payment",
                payment_status="PENDING_VERIFICATION",
            )
        ensure_transition(
            "PENDING",
            "CONFIRMED",
            owner="orders",
            payment_method="bank_transfer",
            payment_status="VALIDATED",
        )

    def test_each_transition_has_one_owner(self):
        accepted = (
            ("PENDING", "CANCELLED", TransitionOwner.ORDERS),
            ("PREPARING", "CANCELLED", TransitionOwner.ORDERS),
            ("READY", "CANCELLED", TransitionOwner.ORDERS),
            ("CONFIRMED", "PREPARING", TransitionOwner.PREPARATION),
            ("PREPARING", "READY", TransitionOwner.PREPARATION),
            ("READY", "OUT_FOR_DELIVERY", TransitionOwner.ROUTES),
            ("OUT_FOR_DELIVERY", "DELIVERED", TransitionOwner.DELIVERY),
        )
        for current, requested, owner in accepted:
            with self.subTest(current=current, requested=requested):
                ensure_transition(current, requested, owner=owner)

    def test_wrong_owner_and_backward_transition_are_rejected(self):
        with self.assertRaisesRegex(InvalidOrderTransition, "belongs to routes"):
            ensure_transition("READY", "OUT_FOR_DELIVERY", owner="orders")
        with self.assertRaisesRegex(InvalidOrderTransition, "Transition not allowed"):
            ensure_transition("DELIVERED", "READY", owner="delivery")

    def test_same_state_is_idempotent_but_still_requires_known_owner(self):
        ensure_transition("CANCELLED", "CANCELLED", owner="orders")
        with self.assertRaisesRegex(InvalidOrderTransition, "Unknown transition owner"):
            ensure_transition("CANCELLED", "CANCELLED", owner="unknown")


if __name__ == "__main__":
    unittest.main()
