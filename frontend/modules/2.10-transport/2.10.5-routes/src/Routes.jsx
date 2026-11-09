import React,{useCallback,useEffect,useState}from'react';
import'./style.css';
import{DetailBackLink,DetailLink}from'../../../../app-shell/src/CommerceDetailLinks.jsx';
import{detailFromHash,readableStatus,shortReference}from'../../../2.3-ecommerce/src/operationView.mjs';

const call=(runtime,path,options={})=>runtime.request(runtime.api+path,{...options,headers:{'X-Tenant-Id':runtime.tenant,'Content-Type':'application/json',...(options.headers||{})}});
const date=value=>{const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value:new Intl.DateTimeFormat('es-VE',{dateStyle:'medium'}).format(parsed);};

export default function Routes({runtime}){
  const[items,setItems]=useState([]),[selected,setSelected]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const load=useCallback(async()=>{setLoading(true);try{const rows=(await call(runtime,`/v1/companies/${runtime.company}/routes`)).items,requested=detailFromHash('routes');setItems(rows);setSelected(rows.find(item=>item.id===requested)||rows[0]||null);setError('');}catch(problem){setError(problem.message);}finally{setLoading(false)}},[runtime]);
  useEffect(()=>{if(runtime.company)load();},[runtime.company]);
  return <section className={`canonical-module routes-module operation-directory ${selected?'detail-open':'list-open'}`}>
    <div className="page-heading"><div><nav className="supplier-breadcrumb"><span>E-commerce</span><span>/</span><span className="current">Operaciones</span></nav><h1>Rutas</h1><p className="supplier-subtitle">Planifica y supervisa las entregas de tus pedidos.</p></div><button disabled={loading} onClick={load}>{loading?'Actualizando…':'Actualizar'}</button></div>
    {error&&<p className="error" role="alert">No se pudieron cargar las rutas. Intenta nuevamente.</p>}
    <div className="operation-master-detail"><div className="panel operation-list">{items.map(route=><div className="operation-list-item" key={route.id}><span><strong>Ruta {shortReference(route.id,'#')}</strong><small>{date(route.date)} · {route.stops.length} {route.stops.length===1?'entrega':'entregas'}</small></span><span className="row-action"><b className="status">{readableStatus(route.status)}</b><DetailLink route="routes" id={route.id}/></span></div>)}{loading?<p role="status">Cargando rutas…</p>:!items.length&&<p>No hay rutas planificadas.</p>}</div>
      <aside className="panel operation-detail">{selected?<><DetailBackLink route="routes" label="rutas"/><header><div><small>RUTA DE ENTREGA</small><h2>{shortReference(selected.id,'#')}</h2></div><span className="status">{readableStatus(selected.status)}</span></header><p>{date(selected.date)} · {selected.stops.length} paradas</p><div className="route-stops">{selected.stops.map((stop,index)=><article key={stop.order_id}><span className="stop-number">{index+1}</span><div><strong>Pedido {shortReference(stop.order_id,'#')}</strong><small>{readableStatus(stop.status)}</small></div></article>)}</div></>:null}</aside>
    </div>
  </section>;
}
