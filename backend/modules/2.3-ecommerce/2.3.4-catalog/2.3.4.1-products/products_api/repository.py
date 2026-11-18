from typing import Any


class ProductsRepository:
    def __init__(self, connection):
        self.connection = connection

    def list(self, status: str | None, search: str | None, limit: int, offset: int = 0) -> dict[str, Any]:
        return self.connection.execute(
            "SELECT catalogo.productos_pagina(%s,%s,%s,%s) AS value", (status, search, limit, offset)
        ).fetchone()["value"]

    def get(self, product_id: str) -> dict[str, Any]:
        product = self.connection.execute(
            "SELECT catalogo.productos_leer(%s,NULL,NULL,1) AS value", (product_id,)
        ).fetchone()["value"]
        relations = self.connection.execute(
            "SELECT catalogo.producto_relaciones_leer(%s) AS value", (product_id,)
        ).fetchone()["value"]
        return {**product, **relations}

    def require_write(self) -> None:
        allowed = self.connection.execute(
            "SELECT plataforma.has_current_tenant_capability('erp.catalog','catalog.products.write') AS allowed"
        ).fetchone()["allowed"]
        if allowed is not True:
            error = PermissionError("Product media write denied")
            error.sqlstate = "42501"
            raise error

    def create(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        product = self.connection.execute(
            """SELECT catalogo.producto_crear(%s,%s,%s,%s,%s,%s,%s,%s,%s) AS value""",
            (payload["name"], payload.get("description", ""), payload["price"], payload.get("status", "ACTIVE"),
             payload.get("category_ref"), payload.get("image_url"), payload.get("attributes", {}),
             payload.get("external_reference"), idempotency_key),
        ).fetchone()["value"]
        if "brand_ref" in payload or "suppliers" in payload:
            relation = self.connection.execute(
                "SELECT catalogo.producto_relaciones_actualizar(%s,%s,%s,%s) AS value",
                (product["id"], product["version"], payload.get("brand_ref"), payload.get("suppliers", [])),
            ).fetchone()["value"]
            product["version"] = relation["version"]
        return self.get(product["id"])

    def update(self, product_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        changes = dict(payload); version = changes.pop("version")
        has_relations = "brand_ref" in changes or "suppliers" in changes
        brand = changes.pop("brand_ref", None); suppliers = changes.pop("suppliers", [])
        if changes:
            updated = self.connection.execute(
                "SELECT catalogo.producto_actualizar(%s,%s,%s) AS value", (product_id, version, changes)
            ).fetchone()["value"]
            version = updated["version"]
        if has_relations:
            relation = self.connection.execute(
                "SELECT catalogo.producto_relaciones_actualizar(%s,%s,%s,%s) AS value",
                (product_id, version, brand, suppliers),
            ).fetchone()["value"]
            version = relation["version"]
        return self.get(product_id)
