"""Only controlled PostgreSQL functions are exposed to the Orders adapter."""
from __future__ import annotations
from typing import Any


class OrdersRepository:
    def __init__(self, connection):
        self.connection = connection

    def list(self, company_id: str, filters: dict[str, Any], limit: int) -> dict[str, Any]:
        row = self.connection.execute(
            """SELECT operaciones.pedidos_listar(
            %s::uuid,%s,%s,%s,%s,%s::date,%s::date,%s::boolean,%s::timestamptz,%s::uuid) AS value""",
            (company_id, filters.get("status"), filters.get("query"), filters.get("payment"), limit,
             filters.get("date_from"), filters.get("date_to"), filters.get("ascending", False),
             filters.get("after"), filters.get("after_id")),
        ).fetchone()
        return row["value"]

    def bulk_transition(self, company_id: str, orders: list[dict[str, Any]], payload: dict[str, Any]) -> list[dict[str, Any]]:
        results = []
        for order in orders:
            command = {**payload, "version": order["version"], "_idempotency_key": None}
            results.append(self.transition(company_id, order["id"], command))
        return results

    def get(self, company_id: str, order_id: str) -> dict[str, Any]:
        row = self.connection.execute(
            "SELECT operaciones.pedidos_leer(%s::uuid,%s::uuid,NULL,1,NULL,NULL) AS value",
            (company_id, order_id),
        ).fetchone()
        result = row["value"]
        result["notes"] = self.connection.execute(
            "SELECT operaciones.pedido_notas_leer(%s::uuid,%s::uuid) AS value", (company_id, order_id)
        ).fetchone()["value"]
        return result

    def add_note(self, company_id: str, order_id: str, note: str, idempotency_key: str) -> dict[str, Any]:
        return self.connection.execute(
            "SELECT operaciones.pedido_nota_crear(%s::uuid,%s::uuid,%s::text,%s::varchar) AS value",
            (company_id, order_id, note, idempotency_key),
        ).fetchone()["value"]

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
        if payload["status"] == "CANCELLED":
            self.connection.execute(
                "SELECT set_config('app.current_operation',%s,true)", ("operations.orders.cancel",)
            )
            return self.connection.execute(
                "SELECT operaciones.pedido_cancelar(%s,%s,%s,%s,%s) AS value",
                (company_id, order_id, payload["version"], payload["reason"], payload.get("detail")),
            ).fetchone()["value"]
        if payload["status"] == "CONFIRMED":
            origin = self.connection.execute(
                "SELECT operaciones.pedido_origen_ecommerce(%s,%s) AS value",
                (company_id, order_id),
            ).fetchone()["value"]
            if origin:
                self.connection.execute(
                    """SELECT set_config('app.current_operation',%s,true),
                    set_config('app.sale_confirmation_reason',%s,true),
                    set_config('app.sale_confirmation_detail',%s,true)""",
                    ("administracion.documento.venta.crear", payload.get("reason") or "", payload.get("detail") or ""),
                )
                # Deterministic fallback preserves the existing transition HTTP contract.
                key = payload.get("_idempotency_key") or f"sv:{order_id}:{payload['version']}"
                sale = self.connection.execute(
                    """SELECT administracion.venta_desde_pedido(
                    %s,%s,%s,%s,%s::date,%s::numeric,%s::date,%s) AS value""",
                    (company_id, order_id, payload["version"], key, payload.get("sale_date"),
                     payload.get("exchange_rate"), payload.get("exchange_date"),
                     payload.get("exchange_source")),
                ).fetchone()["value"]
                self.connection.execute(
                    "SELECT set_config('app.current_operation',%s,true)",
                    ("operations.orders.transition",),
                )
                result = self.get(company_id, order_id)
                result["sale"] = sale
                return result
        row = self.connection.execute(
            "SELECT operaciones.pedido_transicionar(%s,%s,%s,%s,%s,%s) AS value",
            (company_id, order_id, payload["version"], payload["status"],
             payload["reason"], payload.get("detail")),
        ).fetchone()
        return row["value"]
