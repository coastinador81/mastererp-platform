"""Borradores propios: mismas operaciones para el editor y las herramientas de Uony."""
import json
import re
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Request
from psycopg.types.json import Jsonb
from .onboarding import require_user
from .access import workspace_access
from .security import require_origin

TEXT_FIELDS = {'name':500,'sku':80,'brand':200,'category':200,'description':20000,'keywords':2000}
FIELDS = set(TEXT_FIELDS) | {'price','cost','stock','customFields','bullets','preparation','variants','gpsr'}
METADATA = {'id','revision','createdAt','updatedAt','status','source','channels','image','images','bullet_points','stock_data','amazonAttributes','amazonRequirementsContext','amazonMaterialEvidence'}


def fail(code, message, status=400):
    raise HTTPException(status, detail={'error':code,'message':message})


def require_access(connection,user):
    if not user.get('onboarding_completed_at') or workspace_access(connection,user)['status']!='allowed':
        fail('access_required','Activa tu acceso a Uonify para trabajar con productos.',403)


def validate(data):
    if not isinstance(data,dict) or set(data)-FIELDS-METADATA:
        fail('invalid_product','Revisa los campos del producto.')
    if len(json.dumps({k:v for k,v in data.items() if k not in ('preparation','variants','gpsr','amazonAttributes','amazonRequirementsContext','amazonMaterialEvidence')}))>60000: fail('invalid_product','La ficha supera el tamaño permitido.')
    result={k:v for k,v in data.items() if k in FIELDS}
    if 'preparation' in result:
        from .product_preparation_schema import validate_state
        try: result['preparation']=validate_state(result['preparation'])
        except (ValueError,TypeError): fail('invalid_preparation','Revisa los datos de preparación del producto.')
    if 'variants' in result:
        from .product_variants import validate_variants
        try: result['variants']=validate_variants(result['variants'])
        except (ValueError,TypeError): fail('invalid_variants','Revisa las variantes del producto.')
    if 'gpsr' in result:
        from .gpsr_capture import validate_product_gpsr_capture
        try: result['gpsr']=validate_product_gpsr_capture(result['gpsr'])
        except (ValueError,TypeError): fail('invalid_gpsr','Revisa los datos GPSR del producto.')
    for key,limit in TEXT_FIELDS.items():
        if key in result and (not isinstance(result[key],str) or len(result[key])>limit):
            fail('invalid_product','Revisa el texto de la ficha.')
    for key in ['name','sku']:
        if key in result:
            result[key]=result[key].strip()
            if not result[key]: fail('invalid_product','El nombre y el SKU son obligatorios.')
    if 'sku' in result and (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,79}',result['sku']) or result['sku'].lower()=='nuevo'):
        fail('invalid_sku','Usa letras, números, guiones o puntos en el SKU; «nuevo» está reservado.')
    for key in ['price','cost','stock']:
        if key not in result: continue
        value=result[key]
        if value=='': continue
        try:
            number=float(str(value).replace(',','.'))
            if isinstance(value,bool) or not 0<=number<=1e10 or (key=='stock' and not number.is_integer()): raise ValueError()
        except (TypeError,ValueError):fail('invalid_product','Precio, coste y stock deben ser números válidos y no negativos.')
    if 'bullets' in result and (not isinstance(result['bullets'],list) or len(result['bullets'])>6 or any(not isinstance(x,str) or len(x)>2000 for x in result['bullets'])):
        fail('invalid_product','Puedes guardar hasta seis viñetas de 2000 caracteres.')
    if 'customFields' in result:
        fields=result['customFields']
        if not isinstance(fields,list) or len(fields)>80: fail('invalid_product','Revisa los atributos personalizados.')
        for field in fields:
            if not isinstance(field,dict) or set(field)-{'id','name','value','isConfirmed','isDefault','type','source','options'}:
                fail('invalid_product','Revisa los atributos personalizados.')
            if 'options' in field and (not isinstance(field['options'],list) or len(field['options'])>80 or any(not isinstance(x,str) or len(x)>200 for x in field['options'])): fail('invalid_product','Revisa las opciones del atributo.')
            if any(v is not None and (not isinstance(v,(str,bool,int,float)) or len(str(v))>2000) for k,v in field.items() if k!='options'):
                fail('invalid_product','Revisa los atributos personalizados.')
    return result


def present(row):
    return {**row['data'],'sku':row['sku'],'id':str(row['id']),'revision':row['revision'],
            'status':'draft','source':'uonify','channels':{'amazon':False,'shopify':False},
            'createdAt':int(row['created_at'].timestamp()*1000),'updatedAt':int(row['updated_at'].timestamp()*1000)}


def find(connection,user,sku):
    row=connection.execute('SELECT * FROM products WHERE user_id=%s AND lower(sku)=lower(%s) AND deleted_at IS NULL',(user['id'],sku)).fetchone()
    if not row: fail('product_not_found','No se encuentra este producto en tu cuenta.',404)
    return row


def forget_product_assignments(connection,user,product_id):
    # A product deletion also erases goals describing it, including goals
    # linked through an intake. Focus history must not keep deleted details.
    rows=connection.execute('''SELECT DISTINCT a.id FROM uony_assignments a
        LEFT JOIN uony_product_intakes i ON i.user_id=a.user_id AND i.id=a.intake_id
        WHERE a.user_id=%s AND (a.product_id=%s OR i.product_id=%s)''',
        (user['id'],product_id,product_id)).fetchall()
    ids=[row['id'] for row in rows]
    if not ids:
        return
    connection.execute('''DELETE FROM uony_assignment_focus_requests
        WHERE user_id=%s AND (assignment_id=ANY(%s) OR previous_assignment_id=ANY(%s))''',
        (user['id'],ids,ids))
    connection.execute('''DELETE FROM uony_assignment_focus
        WHERE user_id=%s AND assignment_id=ANY(%s)''',(user['id'],ids))
    connection.execute('''UPDATE uony_assignment_focus SET previous_assignment_id=NULL,
        version=version+1,updated_at=now()
        WHERE user_id=%s AND previous_assignment_id=ANY(%s)''',(user['id'],ids))
    connection.execute('DELETE FROM uony_assignments WHERE user_id=%s AND id=ANY(%s)',
                       (user['id'],ids))


def save(connection,user,data,sku=None,source='editor',amazon_state=None):
    require_access(connection,user)
    patch=validate(data)
    current=find(connection,user,sku) if sku else None
    if current:
        current=connection.execute('SELECT * FROM products WHERE user_id=%s AND id=%s AND deleted_at IS NULL FOR UPDATE',(user['id'],current['id'])).fetchone()
    if current and data.get('revision')!=current['revision']:
        fail('product_conflict','La ficha ha cambiado. Actualiza el catálogo y revisa los cambios antes de guardar. Tu edición se conserva.',409)
    content={**(current['data'] if current else {}),**patch}
    if amazon_state is not None:
        content.update(amazon_state)
    elif current and content.get('amazonRequirementsContext'):
        from .product_requirements_mapping import sync_manual
        changed={key for key in patch if current['data'].get(key)!=content.get(key)}
        content=sync_manual(connection,user,current,content,changed)
    if not content.get('name') or not content.get('sku'):fail('invalid_product','El nombre y el SKU son obligatorios.')
    other=connection.execute('SELECT id FROM products WHERE user_id=%s AND lower(sku)=lower(%s) AND deleted_at IS NULL',(user['id'],content['sku'])).fetchone()
    if other and (not current or other['id']!=current['id']):fail('sku_taken','Este SKU ya pertenece a otro producto.',409)
    if current:
        row=connection.execute('UPDATE products SET sku=%s,data=%s,revision=revision+1,updated_at=now() WHERE user_id=%s AND id=%s RETURNING *',(content['sku'],Jsonb(content),user['id'],current['id'])).fetchone()
    else:
        row=connection.execute('INSERT INTO products(user_id,id,sku,data) VALUES(%s,%s,%s,%s) RETURNING *',(user['id'],uuid4(),content['sku'],Jsonb(content))).fetchone()
    connection.execute('INSERT INTO product_revisions(user_id,product_id,revision,data,source) VALUES(%s,%s,%s,%s,%s)',(user['id'],row['id'],row['revision'],Jsonb(content),source))
    return present(row)


def routes(settings,database):
    router=APIRouter(prefix='/api/products')
    @router.get('')
    def listing(request:Request):
        with database.connect() as c:
            user=require_user(c,request)
            rows=c.execute('SELECT * FROM products WHERE user_id=%s AND deleted_at IS NULL ORDER BY updated_at DESC,id',(user['id'],)).fetchall()
            return {'products':[present(row) for row in rows]}
    @router.post('')
    def create(data:dict,request:Request):
        require_origin(request,settings.origin)
        with database.connect() as c:return {'product':save(c,require_user(c,request),data)}
    @router.patch('/{sku}')
    def update(sku:str,data:dict,request:Request):
        require_origin(request,settings.origin)
        with database.connect() as c:return {'product':save(c,require_user(c,request),data,sku)}
    @router.delete('/{sku}')
    def delete(sku:str,request:Request):
        require_origin(request,settings.origin)
        with database.connect() as c:
            user=require_user(c,request);row=find(c,user,sku)
            forget_product_assignments(c,user,row['id'])
            c.execute('''UPDATE uony_threads t SET product_history_cutoff_at=now()
                WHERE t.user_id=%s AND EXISTS (
                    SELECT 1 FROM uony_thread_products b
                    WHERE b.user_id=t.user_id AND b.thread_id=t.id AND b.product_id=%s)''',
                      (user['id'],row['id']))
            c.execute('DELETE FROM uony_thread_products WHERE user_id=%s AND product_id=%s',
                      (user['id'],row['id']))
            c.execute('DELETE FROM uony_return_followups WHERE user_id=%s AND product_id=%s',
                      (user['id'],row['id']))
            c.execute("UPDATE products SET deleted_at=now(),data='{}' WHERE user_id=%s AND id=%s",(user['id'],row['id']))
            c.execute('DELETE FROM product_revisions WHERE user_id=%s AND product_id=%s',(user['id'],row['id']))
            c.execute('DELETE FROM product_requirement_schemas WHERE user_id=%s AND product_id=%s',(user['id'],row['id']))
            return {'ok':True}
    @router.get('/{sku}/gpsr-gate')
    def gpsr_gate(sku:str,request:Request):
        from .product_gpsr_gate import evaluate
        with database.connect() as c:
            user=require_user(c,request)
            row=find(c,user,sku)
            return {'gate':evaluate(c,user,row['data'])}
    return router
