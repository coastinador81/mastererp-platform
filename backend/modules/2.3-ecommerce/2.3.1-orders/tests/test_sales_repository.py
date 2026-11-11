"""Unit doubles only; never a fallback for the deployed repository."""
import unittest
from unittest.mock import Mock
from orders_api.repository import OrdersRepository


def row(value):
    result = Mock()
    result.fetchone.return_value = {"value": value}
    return result


class SalesRepositoryTests(unittest.TestCase):
    def test_ecommerce_confirmation_is_one_controlled_command(self):
        c = Mock()
        c.execute.side_effect = [row(True), Mock(), row({"id": "sale"}), Mock(), row({"status": "CONFIRMED"}), row([])]
        result = OrdersRepository(c).transition("company", "order", {"status": "CONFIRMED", "version": 3})
        self.assertEqual(result, {"status": "CONFIRMED", "notes": [], "sale": {"id": "sale"}})
        calls = c.execute.call_args_list
        self.assertIn("venta_desde_pedido", calls[2].args[0])
        self.assertEqual(calls[2].args[1][3], "sv:order:3")
        self.assertFalse(any("pedido_transicionar" in call.args[0] for call in calls))
        self.assertEqual(calls[3].args[1], ("operations.orders.transition",))

    def test_other_origin_keeps_original_transition(self):
        c = Mock()
        c.execute.side_effect = [row(False), row({"status": "CONFIRMED"})]
        result = OrdersRepository(c).transition("company", "order", {"status": "CONFIRMED", "version": 1, "reason": "OK"})
        self.assertEqual(result["status"], "CONFIRMED")
        self.assertIn("pedido_transicionar", c.execute.call_args.args[0])

    def test_database_error_is_not_masked_by_context_reset_in_aborted_transaction(self):
        c = Mock()
        error = RuntimeError("sanitized test")
        error.sqlstate = "42501"
        c.execute.side_effect = [row(True), Mock(), error]
        with self.assertRaises(RuntimeError) as caught:
            OrdersRepository(c).transition("company", "order", {"status": "CONFIRMED", "version": 1})
        self.assertIs(caught.exception, error)
        self.assertEqual(c.execute.call_count, 3)

    def test_explicit_key_is_forwarded(self):
        c = Mock()
        c.execute.side_effect = [row(True), Mock(), row({"id": "sale"}), Mock(), row({}), row([])]
        OrdersRepository(c).transition("company", "order", {"status": "CONFIRMED", "version": 2, "_idempotency_key": "explicit"})
        self.assertEqual(c.execute.call_args_list[2].args[1][3], "explicit")

    def test_cancellation_uses_coordinated_database_command(self):
        c = Mock(); c.execute.side_effect = [Mock(), row({"status": "CANCELLED"})]
        result = OrdersRepository(c).transition(
            "company", "order", {"status": "CANCELLED", "version": 2, "reason": "CUSTOMER_REQUEST"}
        )
        self.assertEqual(result["status"], "CANCELLED")
        self.assertIn("pedido_cancelar", c.execute.call_args_list[1].args[0])
        self.assertEqual(c.execute.call_args_list[0].args[1], ("operations.orders.cancel",))

    def test_get_includes_persistent_notes(self):
        c = Mock(); c.execute.side_effect = [row({"id": "order"}), row([{"id": "note"}])]
        self.assertEqual(OrdersRepository(c).get("company", "order")["notes"], [{"id": "note"}])
        self.assertIn("%s::uuid,%s::uuid", c.execute.call_args_list[1].args[0])

    def test_note_creation_uses_explicit_database_types(self):
        c = Mock(); c.execute.return_value = row({"id": "note"})
        OrdersRepository(c).add_note("company", "order", "note", "key")
        statement = c.execute.call_args.args[0]
        self.assertIn("%s::uuid,%s::uuid", statement)
        self.assertIn("%s::text,%s::varchar", statement)
