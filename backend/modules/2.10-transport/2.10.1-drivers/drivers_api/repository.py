class DriversRepository:
    def __init__(self, connection):
        self.connection = connection

    def list(self, company_id, node_id, status, limit):
        return self.connection.execute(
            "SELECT transporte.repartidores_leer(%s,%s,NULL,%s,%s) value",
            (company_id, node_id, status, limit),
        ).fetchone()["value"]

    def get(self, company_id, driver_id):
        return self.connection.execute(
            "SELECT transporte.repartidores_leer(%s,NULL,%s,NULL,1) value",
            (company_id, driver_id),
        ).fetchone()["value"]

    def create(self, company_id, payload, idempotency_key):
        return self.connection.execute(
            "SELECT transporte.repartidor_crear(%s,%s,%s,%s,%s,%s,%s,%s) value",
            (company_id, payload["name"], payload["phone"], payload.get("email"),
             payload.get("vehicle", {}), payload.get("license", {}),
             payload.get("external_reference"), idempotency_key),
        ).fetchone()["value"]

    def update(self, company_id, driver_id, payload):
        changes = {key: value for key, value in payload.items() if key != "version"}
        return self.connection.execute(
            "SELECT transporte.repartidor_actualizar(%s,%s,%s,%s) value",
            (company_id, driver_id, payload["version"], changes),
        ).fetchone()["value"]

    def assign(self, company_id, node_id, driver_id, active):
        return self.connection.execute(
            "SELECT transporte.repartidor_asignar_nodo(%s,%s,%s,%s) value",
            (company_id, node_id, driver_id, active),
        ).fetchone()["value"]
