class AttributesRepository:
 def __init__(self,connection):self.connection=connection
 def list(self,status,limit):return self.connection.execute("SELECT catalogo.atributos_leer(NULL,%s,%s) value",(status,limit)).fetchone()["value"]
 def get(self,code):return self.connection.execute("SELECT catalogo.atributos_leer(%s,NULL,1) value",(code,)).fetchone()["value"]
 def create(self,p,key):return self.connection.execute("SELECT catalogo.atributo_crear(%s,%s,%s,%s,%s,%s,%s,%s,%s) value",(p['code'],p['name'],p['type'],p.get('required',False),p.get('options',[]),p.get('unit'),p.get('sort_order',0),p.get('category_slugs',[]),key)).fetchone()['value']
 def update(self,code,p):return self.connection.execute("SELECT catalogo.atributo_actualizar(%s,%s,%s) value",(code,p['version'],{k:v for k,v in p.items() if k!='version'})).fetchone()['value']
