from typing import Any


class ProductsRepository:
    def __init__(self, connection):
        self.connection = connection

    def list(self, status: str | None, search: str | None, limit: int) -> list[dict[str, Any]]:
        return self.connection.execute(
            "SELECT catalogo.productos_leer(NULL,%s,%s,%s) AS value", (status, search, limit)
        ).fetchone()["value"]

    def get(self, product_id: str) -> dict[str, Any]:
        return self.connection.execute(
            "SELECT catalogo.productos_leer(%s,NULL,NULL,1) AS value", (product_id,)
        ).fetchone()["value"]

    def create(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        return self.connection.execute(
            """SELECT catalogo.producto_crear(%s,%s,%s,%s,%s,%s,%s,%s,%s) AS value""",
            (payload["name"], payload.get("description", ""), payload["price"], payload.get("status", "ACTIVE"),
             payload.get("category_ref"), payload.get("image_url"), payload.get("attributes", {}),
             payload.get("external_reference"), idempotency_key),
        ).fetchone()["value"]

    def update(self, product_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        version = payload.pop("version")
        return self.connection.execute(
            "SELECT catalogo.producto_actualizar(%s,%s,%s) AS value", (product_id, version, payload)
        ).fetchone()["value"]
