import React,{useCallback,useEffect,useState} from 'react';
import './style.css';

const STATUSES=['ACTIVE','INACTIVE','DRAFT','DISCONTINUED'];

async function call(runtime,path,options={}) {
  const headers={'X-Tenant-Id':runtime.tenant,'Content-Type':'application/json',...(options.headers||{})};
  if(runtime.request)return runtime.request(runtime.api+path,{...options,headers});
  const token=await window.mastererpAuth?.getAccessToken?.();
  if(!token)throw new Error('Sesión autenticada no disponible.');
  const response=await fetch(runtime.api+path,{...options,headers:{...headers,Authorization:`Bearer ${token}`}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error?.message||`Error ${response.status}`);
  return body;
}

export default function Products({runtime}) {
  const [items,setItems]=useState([]),[search,setSearch]=useState(''),[status,setStatus]=useState('');
  const [selected,setSelected]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const writable=runtime.permissions?.includes('catalog.products.write')??true;
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{const query=new URLSearchParams();if(search)query.set('search',search);if(status)query.set('status',status);setItems((await call(runtime,`/v1/products?${query}`)).items);}
    catch(problem){setError(problem.message);}finally{setLoading(false);}
  },[runtime,search,status]);
  useEffect(()=>{if(runtime.api&&runtime.tenant)load();},[runtime.api,runtime.tenant]);
  async function save(event){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const payload={name:String(form.get('name')).trim(),description:String(form.get('description')).trim(),price:Number(form.get('price')),status:String(form.get('status')),category_ref:String(form.get('category_ref')).trim()||null,image_url:String(form.get('image_url')).trim()||null};
    try{if(selected){payload.version=selected.version;setSelected(await call(runtime,`/v1/products/${selected.id}`,{method:'PATCH',body:JSON.stringify(payload)}));}
      else setSelected(await call(runtime,'/v1/products',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(payload)}));await load();}
    catch(problem){setError(problem.message);}
  }
  return <section className="canonical-module products-module"><header><div><small>CATÁLOGO</small><h1>Productos</h1><p>Ficha maestra comercial. El stock se administra en Inventario.</p></div>{writable&&<button onClick={()=>setSelected(null)}>Nuevo producto</button>}</header>
    <div className="toolbar"><input aria-label="Buscar productos" placeholder="Buscar nombre o código" value={search} onChange={event=>setSearch(event.target.value)}/><select aria-label="Estado" value={status} onChange={event=>setStatus(event.target.value)}><option value="">Todos</option>{STATUSES.map(value=><option key={value}>{value}</option>)}</select><button onClick={load}>Filtrar</button></div>
    {error&&<p className="error" role="alert">{error}</p>}<div className="layout"><div className="list">{loading?<p>Cargando…</p>:items.map(product=><button className="card" key={product.id} onClick={()=>setSelected(product)}><span><strong>{product.name}</strong><small>{product.code}</small></span><span><b>{product.status}</b><strong>{product.price==null?'Sin precio':Number(product.price).toFixed(2)}</strong></span></button>)}{!loading&&!items.length&&<p className="empty">Sin productos.</p>}</div><aside>{writable?<ProductForm product={selected} onSave={save}/>:<p>Tu acceso permite consultar, pero no modificar Productos.</p>}</aside></div>
  </section>;
}

function ProductForm({product,onSave}) {
  return <form key={product?.id||'new'} onSubmit={onSave}><div className="form-head"><div><small>{product?'EDITAR':'NUEVO'}</small><h2>{product?.name||'Producto'}</h2></div>{product&&<span>v{product.version}</span>}</div>
    <label>Nombre<input name="name" maxLength="200" required defaultValue={product?.name||''}/></label><label>Descripción<textarea name="description" maxLength="2000" defaultValue={product?.description||''}/></label><div className="row"><label>Precio<input name="price" type="number" min="0.000001" step="0.000001" required defaultValue={product?.price||''}/></label><label>Estado<select name="status" defaultValue={product?.status||'ACTIVE'}>{STATUSES.map(value=><option key={value}>{value}</option>)}</select></label></div><label>Categoría (referencia)<input name="category_ref" defaultValue={product?.category_ref||''}/></label><label>Imagen pública<input name="image_url" defaultValue={product?.image_url||''}/></label><button className="primary">{product?'Guardar cambios':'Crear producto'}</button>
  </form>;
}
