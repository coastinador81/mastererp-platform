class InventoryRepository:
    def __init__(self,connection):self.connection=connection
    def list(self,company,node,product=None,limit=100):return self.connection.execute("SELECT catalogo.inventario_leer(%s,%s,%s,%s) value",(company,node,product,limit)).fetchone()["value"]
    def set_stock(self,company,node,product,payload,key):return self.connection.execute("SELECT catalogo.inventario_establecer(%s,%s,%s,%s,%s,%s,%s) value",(company,node,product,payload['stock'],payload.get('version',0),payload['reason'],key)).fetchone()["value"]
    def reserve(self,company,node,payload,key):return self.connection.execute("SELECT catalogo.inventario_reservar(%s,%s,%s,%s,%s) value",(company,node,payload['items'],payload.get('reference'),key)).fetchone()["value"]
    def finalize(self,company,reservation,payload):return self.connection.execute("SELECT catalogo.inventario_reserva_finalizar(%s,%s,%s,%s) value",(company,reservation,payload['action'],payload['reason'])).fetchone()["value"]
