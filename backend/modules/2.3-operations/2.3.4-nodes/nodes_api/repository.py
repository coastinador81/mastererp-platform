class NodesRepository:
    def __init__(self, connection): self.connection=connection
    def list(self, company_id, status, limit): return self.connection.execute("SELECT operaciones.nodos_leer(%s,NULL,%s,%s) value",(company_id,status,limit)).fetchone()["value"]
    def get(self, company_id, node_id): return self.connection.execute("SELECT operaciones.nodos_leer(%s,%s,NULL,1) value",(company_id,node_id)).fetchone()["value"]
    def configure(self, company_id, node_id, payload): return self.connection.execute("SELECT operaciones.nodo_configurar(%s,%s,%s) value",(company_id,node_id,payload)).fetchone()["value"]
    def transition(self, company_id, node_id, payload): return self.connection.execute("SELECT operaciones.nodo_transicionar(%s,%s,%s,%s,%s) value",(company_id,node_id,payload["version"],payload["status"],payload["reason"])).fetchone()["value"]
