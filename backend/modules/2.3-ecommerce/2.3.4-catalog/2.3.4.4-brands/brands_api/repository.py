class BrandsRepository:
 def __init__(self,c):self.c=c
 def list(self,status,limit):return self.c.execute("SELECT catalogo.marcas_leer(NULL,%s,%s) value",(status,limit)).fetchone()['value']
 def get(self,slug):return self.c.execute("SELECT catalogo.marcas_leer(%s,NULL,1) value",(slug,)).fetchone()['value']
 def create(self,p,key):return self.c.execute("SELECT catalogo.marca_crear(%s,%s,%s,%s,%s,%s) value",(p['slug'],p['name'],p.get('description',''),p.get('logo_url'),p.get('website_url'),key)).fetchone()['value']
 def update(self,slug,p):return self.c.execute("SELECT catalogo.marca_actualizar(%s,%s,%s) value",(slug,p['version'],{k:v for k,v in p.items() if k!='version'})).fetchone()['value']
