class InventoryReceiptsRepository:
    """Read purchase orders through Finance's controlled database contract."""

    def __init__(self, connection):
        self.connection = connection

    def list_orders(self, company_id, limit, after):
        row = self.connection.execute(
            "SELECT administracion.purchase_read(%s, 'orden_compra', NULL, %s, %s) AS value",
            (company_id, limit, after),
        ).fetchone()
        return row["value"] or []

    def get_order(self, company_id, order_id):
        row = self.connection.execute(
            "SELECT administracion.purchase_read(%s, 'orden_compra', %s, 1, NULL) AS value",
            (company_id, order_id),
        ).fetchone()
        return row["value"]
