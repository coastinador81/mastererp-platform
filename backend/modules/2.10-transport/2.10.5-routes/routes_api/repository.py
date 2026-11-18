class RoutesRepository:
 def __init__(self,c):self.c=c
 def list(self,company,status,query,limit,offset):return self.c.execute("SELECT operaciones.rutas_directorio_leer(%s,%s,%s,%s,%s)value",(company,status,query,limit,offset)).fetchone()['value']
 def get(self,company,id):return self.c.execute("SELECT operaciones.rutas_leer(%s,%s,NULL,1)value",(company,id)).fetchone()['value']
 def create(self,company,p,key):return self.c.execute("SELECT operaciones.ruta_crear(%s,%s,%s,%s,%s,%s)value",(company,p['node_id'],p['date'],p.get('delivery_window_ref'),p['order_ids'],key)).fetchone()['value']
 def assign(self,company,id,p):return self.c.execute("SELECT operaciones.ruta_asignar(%s,%s,%s,%s)value",(company,id,p['version'],p['driver_id'])).fetchone()['value']
 def transition(self,company,id,p):return self.c.execute("SELECT operaciones.ruta_transicionar(%s,%s,%s,%s)value",(company,id,p['version'],p['status'])).fetchone()['value']
 def stop(self,company,id,order,p):return self.c.execute("SELECT operaciones.ruta_parada_finalizar(%s,%s,%s,%s,%s)value",(company,id,order,p['status'],p.get('evidence',{}))).fetchone()['value']
 def driver_route(self,company):return self.c.execute("SELECT operaciones.ruta_repartidor_actual(%s)value",(company,)).fetchone()['value']
 def start_driver_route(self,company):return self.c.execute("SELECT operaciones.ruta_repartidor_iniciar(%s)value",(company,)).fetchone()['value']
 def deliver(self,company,id,order,p):return self.c.execute("SELECT operaciones.ruta_entrega_registrar(%s,%s,%s,%s,%s)value",(company,id,order,p['status'],p['evidence'])).fetchone()['value']
