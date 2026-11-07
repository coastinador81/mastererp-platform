class SuppliersRepository:
 def __init__(self,c):self.c=c
 def list(self,status,limit):return self.c.execute("SELECT catalogo.proveedores_leer(NULL,%s,%s) value",(status,limit)).fetchone()['value']
 def get(self,id):return self.c.execute("SELECT catalogo.proveedores_leer(%s,NULL,1) value",(id,)).fetchone()['value']
 def create(self,p,key):return self.c.execute("SELECT catalogo.proveedor_crear(%s,%s,%s,%s,%s) value",(p['code'],p['name'],p.get('contact',{}),p.get('terms',{}),key)).fetchone()['value']
 def update(self,id,p):return self.c.execute("SELECT catalogo.proveedor_actualizar(%s,%s,%s) value",(id,p['version'],{k:v for k,v in p.items() if k!='version'})).fetchone()['value']
