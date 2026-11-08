"""Herramientas acotadas: preparan cambios; solo se confirman junto con la respuesta."""
from fastapi import HTTPException
from .products import find, present, validate, fail

PROPERTIES={key:{'type':'STRING'} for key in ['name','sku','brand','category','description','keywords','price','cost','stock']}
PROPERTIES['bullets']={'type':'ARRAY','items':{'type':'STRING'}}
PROPERTIES['customFields']={'type':'ARRAY','items':{'type':'OBJECT','properties':{'id':{'type':'STRING'},'name':{'type':'STRING'},'type':{'type':'STRING','enum':['text','number','textarea','select','checkbox','date']},'value':{'type':'STRING'},'options':{'type':'ARRAY','items':{'type':'STRING'}},'isConfirmed':{'type':'BOOLEAN'}},'required':['id','name','type','value','options','isConfirmed']}}
DECLARATIONS=[
 {'name':'list_products','description':'Busca borradores propios por nombre o SKU usando query cuando se conoce. Sin query ofrece una página reciente; hasMore indica que no es el catálogo completo. No son publicaciones Amazon.','parameters':{'type':'OBJECT','properties':{'query':{'type':'STRING','description':'Nombre o SKU conocido, hasta 160 caracteres; no admite identificadores de otra cuenta.'}}}},
 {'name':'get_product','description':'Lee la ficha guardada y su revisión actual antes de editarla.','parameters':{'type':'OBJECT','properties':{'sku':{'type':'STRING'}},'required':['sku']}},
 {'name':'create_product','description':'Prepara una propuesta de borrador con nombre y SKU; no guarda la ficha hasta que el cliente revise y confirme la propuesta. No inventa hechos ni publica.','parameters':{'type':'OBJECT','properties':PROPERTIES,'required':['name','sku']}},
 {'name':'update_product','description':'Prepara una propuesta para editar los campos solicitados de un borrador leído, conservando el resto; no guarda hasta confirmación del cliente. No cambia SKU ni publica.','parameters':{'type':'OBJECT','properties':{'sku':{'type':'STRING'},'revision':{'type':'INTEGER'},'changes':{'type':'OBJECT','properties':{k:v for k,v in PROPERTIES.items() if k!='sku'}}},'required':['sku','revision','changes']}},
]

class ProductTools(dict):
    def __init__(self,status,database,user,active):
        super().__init__(status)
        self.database=database;self.user=user;self.active=active
        self.pending=None;self.reads={};self.search=None
        self['productContext']=active

    def call(self,name,args):
        try:
            if not isinstance(args,dict):fail('invalid_tool','Argumentos no válidos.')
            with self.database.connect() as c:
                if name=='list_products':
                    if not isinstance(args,dict) or set(args)-{'query'}:
                        fail('invalid_tool','Indica solo el nombre o SKU que quieres buscar.')
                    query=args.get('query','')
                    if not isinstance(query,str) or len(query)>160:
                        fail('invalid_tool','La búsqueda admite hasta 160 caracteres.')
                    query=query.strip()
                    rows=c.execute('''SELECT sku,data,revision FROM products
                        WHERE user_id=%s AND deleted_at IS NULL
                        AND (%s='' OR strpos(lower(sku),lower(%s))>0 OR strpos(lower(data->>'name'),lower(%s))>0)
                        ORDER BY updated_at DESC,id LIMIT 101''',(self.user['id'],query,query,query)).fetchall()
                    result={'products':[{'sku':r['sku'],'name':r['data']['name'],'revision':r['revision']} for r in rows[:100]],'hasMore':len(rows)>100}
                    self.search={'query':query,**result}
                    return result
                if name=='get_product' and set(args)=={'sku'} and isinstance(args['sku'],str):
                    product=present(find(c,self.user,args['sku']));self.reads[product['sku']]=product['revision']
                    return {'product':product}
                if name=='create_product':
                    if set(args)-set(PROPERTIES):fail('invalid_tool','Campos no admitidos.')
                    content=validate(args)
                    if not content.get('sku') or not content.get('name'):fail('invalid_tool','Se necesita nombre y SKU.')
                    if c.execute('SELECT 1 FROM products WHERE user_id=%s AND lower(sku)=lower(%s) AND deleted_at IS NULL',(self.user['id'],content['sku'])).fetchone():fail('sku_taken','Este SKU ya existe.')
                    operation={'data':content,'sku':None}
                elif name=='update_product' and set(args)=={'sku','revision','changes'}:
                    if not isinstance(args['sku'],str) or type(args['revision']) is not int or not isinstance(args['changes'],dict):fail('invalid_tool','Argumentos no válidos.')
                    if set(args['changes'])-(set(PROPERTIES)-{'sku'}):fail('invalid_tool','Campos no admitidos.')
                    row=find(c,self.user,args['sku'])
                    if self.reads.get(row['sku'])!=row['revision'] or args['revision']!=row['revision']:fail('read_required','Lee la versión actual con get_product antes de editar.')
                    if self.active and self.active['sku']==row['sku'] and self.active['revision']!=row['revision']:fail('product_conflict','El editor tiene otra revisión. Pide actualizar y revisar la ficha.')
                    operation={'sku':row['sku'],'productId':str(row['id']),
                               'data':{**validate(args['changes']),'revision':row['revision']}}
                else:fail('invalid_tool','Herramienta o argumentos no admitidos.')
                if self.pending and self.pending!=operation:fail('one_change','Solo se prepara una modificación de producto por mensaje.')
                self.pending=operation
                return {'prepared':True,'sku':operation['sku'] or content['sku'],
                        'message':'Propuesta preparada. La ficha no cambiará hasta que el cliente revise y confirme esta acción. No publicada.'}
        except HTTPException as error:return error.detail
