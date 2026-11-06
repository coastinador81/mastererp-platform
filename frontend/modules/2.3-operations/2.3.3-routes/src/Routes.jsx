import React,{useCallback,useEffect,useState}from'react';
import'./style.css';
import{readableStatus,shortReference}from'../../src/operationView.mjs';

const call=(runtime,path,options={})=>runtime.request(runtime.api+path,{...options,headers:{'X-Tenant-Id':runtime.tenant,'Content-Type':'application/json',...(options.headers||{})}});
const date=value=>{const parsed=new Date(value);return Number.isNaN(parsed.getTime())?value:new Intl.DateTimeFormat('es-VE',{dateStyle:'medium'}).format(parsed);};

export default function Routes({runtime}){
  const[items,setItems]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState('');
  const load=useCallback(async()=>{try{const rows=(await call(runtime,`/v1/companies/${runtime.company}/routes`)).items;setItems(rows);setSelected(current=>rows.find(item=>item.id===current?.id)||null);setError('');}catch(problem){setError(problem.message);}},[runtime]);
  useEffect(()=>{if(runtime.company)load();},[runtime.company]);
  return <section className="canonical-module routes-module operation-directory">
    <div className="page-heading"><div><nav className="supplier-breadcrumb"><span>E-commerce</span><span>/</span><span className="current">Gestión de e-Commerce</span></nav><h1>Rutas</h1><p className="supplier-subtitle">Planifica y consulta las entregas de tus pedidos.</p></div><button onClick={load}>Actualizar</button></div>
    {error&&<p className="error" role="alert">No se pudieron cargar las rutas. Intenta nuevamente.</p>}
    <div className="operation-master-detail"><div className="panel operation-list">{items.map(route=><button className="operation-list-item" key={route.id} onClick={()=>setSelected(route)}><span><strong>Ruta {shortReference(route.id,'#')}</strong><small>{date(route.date)} · {route.stops.length} {route.stops.length===1?'entrega':'entregas'}</small></span><b className="status">{readableStatus(route.status)}</b></button>)}{!items.length&&<p>No hay rutas planificadas.</p>}</div>
      <aside className="panel operation-detail">{selected?<><header><div><small>RUTA DE ENTREGA</small><h2>{shortReference(selected.id,'#')}</h2></div><span className="status">{readableStatus(selected.status)}</span></header><p>{date(selected.date)} · {selected.stops.length} paradas</p><div className="route-stops">{selected.stops.map((stop,index)=><article key={stop.order_id}><span className="stop-number">{index+1}</span><div><strong>Pedido {shortReference(stop.order_id,'#')}</strong><small>{readableStatus(stop.status)}</small></div></article>)}</div></>:<div className="operation-empty"><h2>Selecciona una ruta</h2><p>Verás aquí su recorrido y los pedidos asignados.</p></div>}</aside>
    </div>
  </section>;
}
