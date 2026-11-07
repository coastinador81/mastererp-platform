import React,{useCallback,useEffect,useState} from 'react';
import './style.css';
import{DetailBackLink,DetailLink}from'../../../../../app-shell/src/CommerceDetailLinks.jsx';
import{detailFromHash}from'../../../../../app-shell/src/detailRoutes.mjs';

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
    try{const query=new URLSearchParams();if(search)query.set('search',search);if(status)query.set('status',status);const rows=(await call(runtime,`/v1/products?${query}`)).items,requested=detailFromHash('products');setItems(rows);setSelected(requested?rows.find(product=>product.id===requested)||null:null);}
    catch(problem){setError(problem.message);}finally{setLoading(false);}
  },[runtime,search,status]);
  useEffect(()=>{if(runtime.api&&runtime.tenant)load();},[runtime.api,runtime.tenant]);
  async function save(event){
    event.preventDefault();const form=new FormData(event.currentTarget);
    const payload={name:String(form.get('name')).trim(),description:String(form.get('description')).trim(),price:Number(form.get('price')),status:String(form.get('status')),category_ref:String(form.get('category_ref')).trim()||null,image_url:String(form.get('image_url')).trim()||null};
    try{if(selected?.id){payload.version=selected.version;setSelected(await call(runtime,`/v1/products/${selected.id}`,{method:'PATCH',body:JSON.stringify(payload)}));}
      else setSelected(await call(runtime,'/v1/products',{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(payload)}));await load();}
    catch(problem){setError(problem.message);}
  }
  return <section className="canonical-module products-module commerce-directory"><div className="page-heading"><div><nav className="supplier-breadcrumb"><span>E-commerce</span><span>/</span><span className="current">Gestión de Catálogo</span></nav><h1>Productos</h1><p className="supplier-subtitle">Ficha comercial, precio y clasificación del catálogo.</p></div>{writable&&<button onClick={()=>setSelected({})}>Nuevo producto</button>}</div>
    {!selected&&<div className="panel commerce-table-panel"><div className="commerce-toolbar"><input aria-label="Buscar productos" placeholder="Buscar nombre o código" value={search} onChange={event=>setSearch(event.target.value)}/><select aria-label="Estado" value={status} onChange={event=>setStatus(event.target.value)}><option value="">Todos</option>{STATUSES.map(value=><option key={value}>{value}</option>)}</select><button onClick={load}>Filtrar</button></div><div className="table-scroll"><table className="commerce-table"><thead><tr><th>Producto</th><th>Referencia</th><th>Precio</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{items.map(product=><tr key={product.id}><td><strong>{product.name}</strong></td><td>{product.code||'—'}</td><td>{product.price==null?'Sin precio':Number(product.price).toFixed(2)}</td><td><span className="status">{product.status}</span></td><td><DetailLink route="products" id={product.id}/></td></tr>)}</tbody></table></div>{loading&&<p className="table-message">Cargando…</p>}{!loading&&!items.length&&<p className="table-message">No hay productos.</p>}</div>}
    {error&&<p className="error" role="alert">No se pudieron cargar los productos. Intenta nuevamente.</p>}{selected&&<aside className="panel operation-detail prestashop-detail"><DetailBackLink route="products" label="productos"/><header><div><small>{selected.id?'FICHA DE PRODUCTO':'NUEVO PRODUCTO'}</small><h2>{selected.name||'Producto'}</h2><p>{selected.code||'Completa la información comercial'}</p></div></header><div className="commerce-detail-body">{writable?<ProductForm product={selected.id?selected:null} onSave={save}/>:<ProductReadOnly product={selected}/>}</div></aside>}
  </section>;
}

function ProductReadOnly({product}){return <div className="detail-cards"><section><small>DESCRIPCIÓN</small><h3>{product.name}</h3><p>{product.description||'Sin descripción'}</p></section><section><small>PRECIO</small><h3>{product.price==null?'Sin precio':Number(product.price).toFixed(2)}</h3><p>Estado: {product.status}</p></section><section><small>CLASIFICACIÓN</small><h3>{product.category_ref||'Sin categoría'}</h3><p>Referencia {product.code||'no disponible'}</p></section></div>}

function ProductForm({product,onSave}) {
  return <form key={product?.id||'new'} onSubmit={onSave}><div className="form-head"><div><small>{product?'EDITAR':'NUEVO'}</small><h2>{product?.name||'Producto'}</h2></div></div>
    <label>Nombre<input name="name" maxLength="200" required defaultValue={product?.name||''}/></label><label>Descripción<textarea name="description" maxLength="2000" defaultValue={product?.description||''}/></label><div className="row"><label>Precio<input name="price" type="number" min="0.000001" step="0.000001" required defaultValue={product?.price||''}/></label><label>Estado<select name="status" defaultValue={product?.status||'ACTIVE'}>{STATUSES.map(value=><option key={value}>{value}</option>)}</select></label></div><label>Categoría (referencia)<input name="category_ref" defaultValue={product?.category_ref||''}/></label><label>Imagen pública<input name="image_url" defaultValue={product?.image_url||''}/></label><button className="primary">{product?'Guardar cambios':'Crear producto'}</button>
  </form>;
}
