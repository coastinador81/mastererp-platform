class EcommerceRepository:
    def __init__(self, connection):
        self.connection = connection

    def list(self, company_id, limit):
        return self.connection.execute("SELECT ventas_digitales.tiendas_leer(%s,NULL,%s) value", (company_id, limit)).fetchone()["value"]

    def get(self, company_id, store_id):
        return self.connection.execute("SELECT ventas_digitales.tiendas_leer(%s,%s,1) value", (company_id, store_id)).fetchone()["value"]

    def configure(self, company_id, store_id, payload):
        return self.connection.execute(
            "SELECT ventas_digitales.tienda_configurar(%s,%s,%s,%s,%s,%s,%s) value",
            (company_id, store_id, payload.get("node_id"), payload.get("domain"), payload.get("name"), payload.get("version"), payload.get("changes", {})),
        ).fetchone()["value"]

    def public_catalog(self, domain, limit):
        return self.connection.execute("SELECT ventas_digitales.catalogo_publico(%s,%s) value", (domain, limit)).fetchone()["value"]

    def create_invitation(self, company_id, store_id, customer_id, token_hash, expires_at):
        return self.connection.execute(
            "SELECT ventas_digitales.cliente_invitacion_crear(%s,%s,%s,%s,%s) value",
            (company_id, store_id, customer_id, token_hash, expires_at),
        ).fetchone()["value"]

    def claim_identity(self, claims, token):
        return self.connection.execute(
            "SELECT ventas_digitales.cliente_identidad_reclamar(%s,%s,%s,%s,%s) value",
            (claims["iss"], claims["sub"], claims["email"], claims.get("name") or claims["email"], token),
        ).fetchone()["value"]
