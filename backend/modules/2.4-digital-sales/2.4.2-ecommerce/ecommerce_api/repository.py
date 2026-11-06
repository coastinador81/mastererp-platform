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

    def register_identity(self, claims, domain):
        return self.connection.execute(
            "SELECT ventas_digitales.cliente_identidad_registrar(%s,%s,%s,%s,%s) value",
            (claims["iss"], claims["sub"], claims["email"], claims.get("name") or claims["email"], domain),
        ).fetchone()["value"]

    def checkout(self, claims, payload, idempotency_key):
        return self.connection.execute(
            "SELECT ventas_digitales.checkout_crear(%s,%s,%s,%s,%s,%s,%s,%s) value",
            (claims["iss"], claims["sub"], payload["domain"], payload["items"],
             payload["delivery"], payload["delivery_method"],
             payload["payment_method"], idempotency_key),
        ).fetchone()["value"]

    def customer_read(self, claims, domain, section, item_id=None, limit=25):
        return self.connection.execute(
            "SELECT ventas_digitales.cliente_portal_leer(%s,%s,%s,%s,%s,%s) value",
            (claims["iss"], claims["sub"], domain, section, item_id, limit),
        ).fetchone()["value"]

    def update_profile(self, claims, domain, payload):
        return self.connection.execute(
            "SELECT ventas_digitales.cliente_perfil_actualizar(%s,%s,%s,%s,%s,%s,%s) value",
            (claims["iss"], claims["sub"], domain, payload["name"], payload["phone"],
             payload["birthDate"], payload.get("photoUrl")),
        ).fetchone()["value"]

    def save_address(self, claims, domain, payload, address_id=None):
        return self.connection.execute(
            "SELECT ventas_digitales.cliente_direccion_guardar(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) value",
            (claims["iss"], claims["sub"], domain, address_id, payload.get("label"),
             payload.get("address"), payload.get("zone"), payload.get("unit"), payload.get("reference"),
             payload.get("latitude"), payload.get("longitude"), payload.get("default", False), payload.get("version")),
        ).fetchone()["value"]
