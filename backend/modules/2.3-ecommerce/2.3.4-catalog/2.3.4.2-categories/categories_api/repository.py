class CategoriesRepository:
    def __init__(self, connection): self.connection=connection
    def list(self,status,limit): return self.connection.execute("SELECT catalogo.categorias_leer(NULL,%s,%s) value",(status,limit)).fetchone()["value"]
    def get(self,slug): return self.connection.execute("SELECT catalogo.categorias_leer(%s,NULL,1) value",(slug,)).fetchone()["value"]
    def create(self,payload,key): return self.connection.execute("SELECT catalogo.categoria_crear(%s,%s,%s,%s,%s,%s,%s) value",(payload["slug"],payload["name"],payload.get("description",""),payload.get("parent_slug"),payload.get("image_url"),payload.get("sort_order",0),key)).fetchone()["value"]
    def update(self,slug,payload):
        version=payload["version"];changes={key:value for key,value in payload.items() if key!="version"}
        return self.connection.execute("SELECT catalogo.categoria_actualizar(%s,%s,%s) value",(slug,version,changes)).fetchone()["value"]
