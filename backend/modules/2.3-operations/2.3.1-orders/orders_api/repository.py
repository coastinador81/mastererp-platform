"""Only controlled PostgreSQL functions are exposed to the Orders adapter."""
from typing import Any


class OrdersRepository:
    def __init__(self, connection):
        self.connection = connection

    def list(self, company_id: str, status: str | None, limit: int) -> list[dict[str, Any]]:
        row = self.connection.execute(
            "SELECT operaciones.pedidos_leer(%s,NULL,%s,%s,NULL,NULL) AS value",
            (company_id, status, limit),
        ).fetchone()
        return row["value"]

    def get(self, company_id: str, order_id: str) -> dict[str, Any]:
        row = self.connection.execute(
            "SELECT operaciones.pedidos_leer(%s,%s,NULL,1,NULL,NULL) AS value",
            (company_id, order_id),
        ).fetchone()
        return row["value"]

    def create(self, company_id: str, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        row = self.connection.execute(
            """SELECT operaciones.pedido_crear(
            %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) AS value""",
            (company_id, payload["branch_id"], payload["customer_id"], payload["currency"],
             payload["items"], payload["customer_snapshot"], payload["delivery_snapshot"],
             payload["payment_snapshot"], payload["delivery_window_ref"], payload["delivery_method"],
             payload["inventory_reservation_ref"], payload.get("delivery_fee", 0),
             payload.get("external_reference"), idempotency_key),
        ).fetchone()
        return row["value"]

    def transition(self, company_id: str, order_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        row = self.connection.execute(
            "SELECT operaciones.pedido_transicionar(%s,%s,%s,%s,%s,%s) AS value",
            (company_id, order_id, payload["version"], payload["status"],
             payload["reason"], payload.get("detail")),
        ).fetchone()
        return row["value"]
