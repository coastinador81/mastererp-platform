import React,{useCallback,useEffect,useState}from'react';
import'./style.css';
import{readableStatus,shortReference}from'../../src/operationView.mjs';

const call=(runtime,path,options={})=>runtime.request(runtime.api+path,{...options,headers:{'X-Tenant-Id':runtime.tenant,'Content-Type':'application/json',...(options.headers||{})}});

export default function Preparation({runtime}){
  const[items,setItems]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState('');
  const write=runtime.permissions.includes('operations.preparation.item.update');
  const load=useCallback(async()=>{try{const rows=(await call(runtime,`/v1/companies/${runtime.company}/preparations`)).items;setItems(rows);setSelected(current=>rows.find(item=>item.order_id===current?.order_id)||null);setError('');}catch(problem){setError(problem.message);}},[runtime]);
  useEffect(()=>{if(runtime.company)load();},[runtime.company]);
  async function mark(item,status){try{await call(runtime,`/v1/companies/${runtime.company}/orders/${selected.order_id}/preparation/items/${item.line_id}`,{method:'PATCH',body:JSON.stringify({version:item.version,status,reason:status==='PENDING'?'REAPERTURA_MANUAL':null})});await load();}catch(problem){setError(problem.message);}}
  return <section className="canonical-module preparation-module operation-directory">
    <div className="page-heading"><div><nav className="supplier-breadcrumb"><span>E-commerce</span><span>/</span><span className="current">Gestión de e-Commerce</span></nav><h1>Preparación</h1><p className="supplier-subtitle">Revisa y completa los productos de cada pedido.</p></div><button onClick={load}>Actualizar</button></div>
    {error&&<p className="error" role="alert">No se pudo cargar la preparación. Intenta nuevamente.</p>}
    <div className="operation-master-detail"><div className="panel operation-list">{items.map(order=><button className="operation-list-item" key={order.order_id} onClick={()=>setSelected(order)}><span><strong>Pedido {shortReference(order.order_id,'#')}</strong><small>{order.items.length} {order.items.length===1?'producto':'productos'}</small></span><b className="status">{readableStatus(order.status)}</b></button>)}{!items.length&&<p>No hay pedidos pendientes de preparación.</p>}</div>
      <aside className="panel operation-detail">{selected?<><header><div><small>PEDIDO</small><h2>{shortReference(selected.order_id,'#')}</h2></div><span className="status">{readableStatus(selected.status)}</span></header><p>Marca cada producto cuando esté listo para despacho.</p><div className="checklist">{selected.items.map((item,index)=><div className="checklist-row" key={item.line_id}><span className={item.status==='DONE'?'check done':'check'}>{item.status==='DONE'?'✓':index+1}</span><div><strong>Producto {index+1}</strong><small>{readableStatus(item.status)}</small></div>{write&&<button className="secondary" onClick={()=>mark(item,item.status==='DONE'?'PENDING':'DONE')}>{item.status==='DONE'?'Reabrir':'Marcar listo'}</button>}</div>)}</div></>:<div className="operation-empty"><h2>Selecciona un pedido</h2><p>Verás aquí su checklist de preparación.</p></div>}</aside>
    </div>
  </section>;
}
