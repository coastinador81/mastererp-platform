class PreparationRepository:
 def __init__(self,c):self.c=c
 def list(self,company,status,limit):return self.c.execute("SELECT operaciones.preparacion_leer(%s,NULL,%s,%s) value",(company,status,limit)).fetchone()['value']
 def get(self,company,order):return self.c.execute("SELECT operaciones.preparacion_leer(%s,%s,NULL,1) value",(company,order)).fetchone()['value']
 def start(self,company,order,p):return self.c.execute("SELECT operaciones.preparacion_iniciar(%s,%s,%s,%s) value",(company,order,p['node_id'],p['order_version'])).fetchone()['value']
 def item(self,company,order,line,p):return self.c.execute("SELECT operaciones.preparacion_linea_marcar(%s,%s,%s,%s,%s,%s) value",(company,order,line,p['version'],p['status'],p.get('reason'))).fetchone()['value']
 def complete(self,company,order,p):return self.c.execute("SELECT operaciones.preparacion_completar(%s,%s,%s) value",(company,order,p['version'])).fetchone()['value']
