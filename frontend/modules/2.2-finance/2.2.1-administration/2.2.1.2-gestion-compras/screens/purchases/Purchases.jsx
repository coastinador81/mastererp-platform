import React,{useEffect,useRef,useState} from 'react';
import FinanceIcon from '../../../../src/FinanceIcon.jsx';
import PurchaseForm,{purchaseKinds,emptyPurchase,purchasePayload} from './PurchaseForm.jsx';
const API=window.location.origin==='https://finanzas-dev.uonify.com'?window.location.origin:'https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com';
const messages={400:'Revisa proveedor, documento de origen, fechas e importes. Cada total de línea debe respetar los decimales de la moneda.',401:'Tu sesión ha caducado.',403:'No tienes acceso a esta operación.',404:'El documento no está disponible en esta empresa.',409:'Conflicto: versión obsoleta, origen utilizado o referencia repetida. Recarga el documento.',503:'El servicio no está disponible. Puedes reintentar.'};
export default function Purchases({workspace,capacity,path,navigate}){
 const {tenant,company,context,request,denied}=workspace,kind=purchaseKinds[capacity],base='/modulos/finanzas/administracion/'+capacity;
 const tail=path.slice(base.length).split('/').filter(Boolean),create=tail[0]==='nuevo',id=tail[0]&&!create?tail[0]:null,edit=tail[1]==='editar';
 const canRead=context.permissions.includes('administration.purchases.read'),canWrite=context.permissions.includes('administration.purchases.write');
 const [data,setData]=useState(null),[options,setOptions]=useState(null),[sources,setSources]=useState([]),[sourceCursor,setSourceCursor]=useState(null),[supplierMore,setSupplierMore]=useState(false);
 const [draft,setDraft]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[reload,setReload]=useState(0),[cursor,setCursor]=useState(''),[pages,setPages]=useState([]);
 const active=useRef(true),key=useRef(null),headers={'X-MasterERP-Tenant-Id':tenant};
 const get=(resource,extra={})=>request(API+'/v1/administration/compras/'+resource+'?'+new URLSearchParams({company_id:company,...extra}),{headers});
 const fail=e=>{if(e.name==='AbortError'||!active.current)return;setError(messages[e.status]||'No se pudo completar la operación. Reintenta el mismo contenido.');if(e.status===403)denied();};
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{let live=true;setLoading(true);setError('');setData(null);setDraft(null);key.current=null;
  if(!canRead){setLoading(false);return()=>{live=false;};}
  (async()=>{try{
   if(create||edit){const [lookup,result,origins]=await Promise.all([get('opciones',{limit:'100'}),id?get(kind.api+'/'+id):Promise.resolve(null),kind.source?get(kind.source,{limit:'100'}):Promise.resolve(null)]);
    if(!live)return;
    if(result&&!lookup.data.proveedores.some(s=>s.id===result.data.proveedor_id))lookup.data.proveedores.push({id:result.data.proveedor_id,codigo:'',nombre:result.data.proveedor});
    if(result?.data.origen_id&&origins&&!origins.data.items.some(s=>s.id===result.data.origen_id))origins.data.items.push({id:result.data.origen_id,numero:result.data.origen_id,proveedor:result.data.proveedor,moneda:result.data.moneda,total:''});
    setOptions(lookup.data);setSupplierMore(lookup.data.proveedores.length===100);setSources(origins?.data.items||[]);setSourceCursor(origins?.data.next_cursor);setData(result?.data||null);setDraft(result?purchasePayload(result.data):emptyPurchase(lookup.data.moneda_base));
   }else{const result=await get(kind.api+(id?'/'+id:''),{limit:'10',...(cursor?{after:cursor}:{})});if(live)setData(result.data);}
  }catch(e){if(live)fail(e);}finally{if(live)setLoading(false);}})();return()=>{live=false;};
 },[path,cursor,reload,tenant,company,canRead]);
 const loadSuppliers=async()=>{try{const r=await get('opciones',{limit:'100',after:options.proveedores.at(-1).id});if(active.current){setOptions(o=>({...o,proveedores:[...o.proveedores,...r.data.proveedores]}));setSupplierMore(r.data.proveedores.length===100);}}catch(e){fail(e);}};
 const loadSources=async()=>{try{const r=await get(kind.source,{limit:'100',after:sourceCursor});if(active.current){setSources(s=>[...s,...r.data.items]);setSourceCursor(r.data.next_cursor);}}catch(e){fail(e);}};
 const onSource=async source=>{if(!source){setDraft(emptyPurchase(options.moneda_base));return;}try{const r=await get(kind.source+'/'+source);if(!active.current)return;const parent=r.data;
  setDraft({...purchasePayload(parent),origen_id:parent.id,fecha:new Date().toLocaleDateString('en-CA'),numero:'',serie:''});
  if(!options.proveedores.some(s=>s.id===parent.proveedor_id))setOptions(o=>({...o,proveedores:[...o.proveedores,{id:parent.proveedor_id,codigo:'',nombre:parent.proveedor}]}));
 }catch(e){fail(e);}};
 const save=async e=>{e.preventDefault();if(busy||!canWrite)return;setBusy(true);setError('');const body={company_id:company,documento:draft,...(edit?{version:data.version}:{})},fingerprint=JSON.stringify(body);
  if(!key.current||key.current.fingerprint!==fingerprint)key.current={fingerprint,value:crypto.randomUUID()};
  try{const r=await request(API+'/v1/administration/compras/'+kind.api+(edit?'/'+id:''),{method:edit?'PATCH':'POST',headers:{...headers,'Content-Type':'application/json',...(!edit?{'Idempotency-Key':key.current.value}:{})},body:fingerprint});if(active.current){key.current=null;navigate(base+'/'+r.data.id);}}catch(e){fail(e);}finally{if(active.current)setBusy(false);}
 };
 const goToPreviousListPage=()=>{setCursor(pages.at(-1));setPages(p=>p.slice(0,-1));};
 const isOrders=capacity==='ordenes-compra';
 const orderListing=isOrders&&!id&&!create;
 const heading=isOrders
  ?create?'Nuevo registro':edit?'Editar registro':id&&data?`Borrador — ${kind.title}`:kind.title
  :create?`Crear borrador — ${kind.title}`:edit?`Editar borrador — ${kind.title}`:id&&data?`Borrador — ${kind.title}`:kind.title;
 if(!canRead)return <p className="notice" role="alert">No tienes permiso para consultar compras.</p>;
 if(loading)return <p role="status">Cargando {kind.title.toLowerCase()}…</p>;
 return <section className={orderListing?'supplier-directory':undefined} aria-labelledby={orderListing||isOrders&&(create||edit)?'purchases-order-title':undefined}><div className="page-heading"><div>{
 orderListing?<><nav className="supplier-breadcrumb" aria-label="Ruta de navegación"><a href="/" onClick={event=>{if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();navigate('/modulos/finanzas');}}}>Finanzas</a><span>/</span><span>Administración</span><span>/</span><span className="current">Gestión de compras</span></nav><h1 id="purchases-order-title">{kind.title}</h1><p className="supplier-subtitle">Crea borradores de orden a partir de una solicitud de compra; el servicio valida origen y datos.</p></>
 :isOrders&&(create||edit)?<><p className="eyebrow">Finanzas / Administración</p><h1 id="purchases-order-title">{heading}</h1>{create&&<p className="muted">Los documentos son borradores; guardar no aprueba, emite ni genera efectos contables.</p>}</>
 :<><nav className="eyebrow" aria-label="Ruta de navegación">Finanzas / Administración / Gestión de compras / {kind.title}</nav><h1>{heading}</h1>{id&&!edit&&data&&<p className="muted">{data.numero||'Sin referencia'} · Versión {data.version}</p>}{(create||edit)&&<p className="muted">Los documentos son borradores; guardar no aprueba, emite ni genera efectos contables.</p>}</>
 }</div>{orderListing&&canWrite?<button className="supplier-create" type="button" onClick={()=>navigate(base+'/nuevo')}><FinanceIcon name="order"/>Crear orden</button>:!id&&!create&&canWrite&&!orderListing?<button type="button" onClick={()=>navigate(base+'/nuevo')}>Crear {kind.singular}</button>:null}</div>
  {error&&<div className="notice error" role="alert">{error} <button className="secondary" onClick={()=>setReload(r=>r+1)}>Recargar</button></div>}
  {(create||edit)&&!canWrite&&<p className="notice" role="alert">No tienes permiso para guardar compras.</p>}
  {(create||edit)&&draft&&canWrite&&<PurchaseForm {...{kind,draft,setDraft,options,sources,onSource,save,busy}} editing={edit} moreSuppliers={supplierMore?loadSuppliers:null} moreSources={sourceCursor?loadSources:null} cancel={()=>navigate(id?base+'/'+id:base)}/>}
  {id&&!edit&&data&&<div className="panel detail"><p className="muted" role="note"><strong>Borrador</strong> · Solo lectura de líneas y totales; las reglas de negocio las aplica el servicio al guardar.</p><dl><dt>Proveedor</dt><dd>{data.proveedor}</dd><dt>Fecha</dt><dd>{data.fecha}</dd><dt>Total</dt><dd>{data.moneda} {data.total}</dd><dt>Total en moneda base</dt><dd>{data.moneda_base} {data.total_base}</dd><dt>Tipo de cambio</dt><dd>{data.tipo_cambio} · {data.cambio_fecha} · {data.cambio_fuente}</dd></dl>
   <div className="table-scroll"><table><thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio</th><th>Total</th></tr></thead><tbody>{data.lineas.map((l,i)=><tr key={i}><td>{l.descripcion}</td><td>{l.cantidad}</td><td>{l.precio_unitario}</td><td>{l.total}</td></tr>)}</tbody></table></div>
   <div className="actions"><button className="secondary" onClick={()=>navigate(base)}>Volver al listado</button>{canWrite&&data.editable&&<button onClick={()=>navigate(base+'/'+id+'/editar')}>Editar</button>}</div>{!data.editable&&<p className="notice">Tiene un documento derivado; este borrador se conserva sin cambios.</p>}</div>}
  {!id&&!create&&data&&<div className={orderListing?'panel supplier-directory-panel':'panel'}>{data.items.length?<><div className="table-scroll"><table className={orderListing?'suppliers-table':undefined}><thead><tr><th>Referencia</th><th>Fecha</th><th>Proveedor</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{data.items.map(row=><tr key={row.id}><td>{row.numero||'Sin referencia'}</td><td>{row.fecha}</td><td>{row.proveedor}</td><td>{row.moneda} {row.total}</td><td>Borrador</td><td><button className="secondary" onClick={()=>navigate(base+'/'+row.id)}>Ver detalle</button></td></tr>)}</tbody></table></div>
   <div className={orderListing?'pagination supplier-pagination':'pagination'}><button className="secondary" disabled={!pages.length} onClick={goToPreviousListPage}>Anterior</button><span>{orderListing?'Máximo 10 registros por página':'10 registros por página'}</span><button className="secondary" disabled={!data.next_cursor} onClick={()=>{setPages(p=>[...p,cursor]);setCursor(data.next_cursor);}}>Siguiente</button></div></>:pages.length?<><p className="empty" role="status">No hay registros en esta página.</p><div className={orderListing?'pagination supplier-pagination':'pagination'}><button type="button" className="secondary" onClick={goToPreviousListPage}>Página anterior</button></div></>:<p className="empty" role="status">No hay {kind.title.toLowerCase()} en esta empresa.</p>}</div>}
 </section>;
}
