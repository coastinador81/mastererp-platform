import React,{useCallback,useEffect,useMemo,useState}from'react';
import'./style.css';
import{DetailBackLink,DetailLink}from'../../../../app-shell/src/CommerceDetailLinks.jsx';
import{detailHref,listHref}from'../../../../app-shell/src/detailRoutes.mjs';
import{detailFromHash}from'../../../2.3-ecommerce/src/operationView.mjs';
import{money}from'../../../2.3-ecommerce/2.3.1-orders/src/orderView.js';
import StatusBadge from'../../../../shared/status-badge/StatusBadge.jsx';
import LoadingState from'../../../../shared/loading-state/LoadingState.jsx';
import{QUEUE_STATUSES,buildQueue,canComplete,progressOf,stageLabel}from'./preparationQueue.mjs';

const call=(runtime,path,options={})=>runtime.request(runtime.api+path,{...options,headers:{'X-Tenant-Id':runtime.tenant,'Content-Type':'application/json',...(options.headers||{})}});
const customerName=order=>order.customer_snapshot?.name||'Cliente del pedido';
const day=value=>new Intl.DateTimeFormat('es-VE',{dateStyle:'medium'}).format(new Date(value));

function QueueRow({entry,index}){
  const progress=progressOf(entry),[label,tone]=stageLabel(entry.stage);
  const action=entry.stage==='NOT_STARTED'?'Iniciar':entry.stage==='READY'?'Ver detalle':'Preparar';
  return <div className="preparation-row"><span className="queue-number">{index+1}</span><span><strong>{entry.order.number}</strong><small>{customerName(entry.order)} · {day(entry.order.created_at)}</small></span><span><strong>{entry.items.length}</strong><small>{entry.items.length===1?'producto':'productos'}</small></span><StatusBadge tone={tone}>{label}</StatusBadge><span className="preparation-progress"><i><b style={{width:`${progress}%`}}/></i><small>{progress}%</small></span><DetailLink route="preparation" id={entry.order.id} label={action}/></div>;
}

function NextStep({entry,write,busy,start,complete}){
  if(entry.stage==='READY')return <section className="ops-detail-card preparation-summary"><header><h2>Listo para despacho</h2></header><p>Asigna el pedido a una ruta para enviarlo al cliente.</p><a className="primary" href={listHref('routes')}>Ir a rutas</a></section>;
  if(!write)return null;
  if(entry.stage==='NOT_STARTED')return <section className="ops-detail-card preparation-summary"><header><h2>Siguiente paso</h2></header><p>{entry.order.status==='PREPARING'?'Este pedido se marcó en preparación sin lista de productos. Inícialo para crearla.':'Inicia la preparación para marcar los productos.'}</p><button className="primary" disabled={busy} onClick={start}>{busy?'Iniciando…':'Iniciar preparación'}</button></section>;
  return null;
}

function CompletionStep({entry,write,busy,complete}){
  if(!write||entry.stage!=='IN_PROGRESS')return null;
  const pending=entry.items.filter(item=>item.status!=='DONE').length,ready=canComplete(entry);
  return <footer className={`preparation-completion ${ready?'ready':''}`}><div><small>PASO 2</small><strong>{ready?'Productos confirmados':'Finaliza la preparación'}</strong><p>{ready?'Ya puedes dejar el pedido listo para despacho.':`Falta confirmar ${pending} ${pending===1?'producto':'productos'} en la lista.`}</p></div><button className="primary" disabled={busy||!ready} onClick={complete}>{busy?'Guardando…':'Finalizar preparación'}</button></footer>;
}

export default function Preparation({runtime}){
  const[entries,setEntries]=useState([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[view,setView]=useState('list'),[nodes,setNodes]=useState({});
  const requested=detailFromHash('preparation'),write=runtime.permissions.includes('operations.preparation.write');
  const load=useCallback(async()=>{setLoading(true);try{
    const base=`/v1/companies/${runtime.company}`;
    const[orderLists,preparations,nodeRows]=await Promise.all([
      Promise.all(QUEUE_STATUSES.map(status=>call(runtime,`${base}/orders?status=${status}&limit=100`).then(value=>value.items))),
      call(runtime,`${base}/preparations?status=IN_PROGRESS&limit=100`).then(value=>value.items),
      runtime.permissions.includes('operations.nodes.read')?call(runtime,`${base}/nodes`).then(value=>value.items).catch(()=>[]):[]]);
    setEntries(buildQueue(orderLists.flat(),preparations));setNodes(Object.fromEntries(nodeRows.map(node=>[node.id,node.name])));setError('');
  }catch(problem){setError(problem.message);}finally{setLoading(false)}},[runtime]);
  useEffect(()=>{if(runtime.company)void load();},[runtime.company,load]);
  const selected=useMemo(()=>entries.find(entry=>entry.order.id===requested)||null,[entries,requested]);
  const metrics=useMemo(()=>({pending:entries.filter(entry=>entry.stage!=='READY').length,products:entries.reduce((sum,entry)=>sum+(entry.stage==='READY'?0:entry.items.filter(item=>item.status!=='DONE').length),0),ready:entries.filter(entry=>entry.stage==='READY').length}),[entries]);
  async function act(path,body){setBusy(true);try{await call(runtime,`/v1/companies/${runtime.company}/orders/${selected.order.id}/preparation${path}`,{method:path.startsWith('/items')?'PATCH':'POST',body:JSON.stringify(body)});await load();}catch(problem){setError(problem.message);}finally{setBusy(false)}}
  const start=()=>act('/start',{node_id:selected.order.branch_id,order_version:selected.order.version});
  const complete=()=>{if(window.confirm(`¿Completar la preparación del pedido ${selected.order.number}? Quedará listo para despacho.`))void act('/complete',{version:selected.preparation.version});};
  function mark(item){const done=item.status==='DONE',reason=done?window.prompt('Indica por qué este producto vuelve a pendiente')?.trim():null;if(done&&!reason)return;void act(`/items/${item.line_id}`,{version:item.version,status:done?'PENDING':'DONE',reason});}
  if(requested&&!selected)return <section className="canonical-module preparation-module operation-directory">{loading?<LoadingState label="Cargando pedido…"/>:<><DetailBackLink route="preparation" label="preparación"/><p className="table-message">Este pedido no está en la cola de preparación.</p><a className="secondary" href={detailHref('orders',requested)}>Ver pedido</a></>}</section>;
  return <section className="canonical-module preparation-module operation-directory"><div className="page-heading"><div><nav className="supplier-breadcrumb"><span>E-commerce</span><span>/</span><span className="current">Operaciones</span></nav><h1>Preparación</h1><p className="supplier-subtitle">Organiza los productos y déjalos listos para despacho.</p></div><button disabled={loading} onClick={()=>void load()}>{loading?'Actualizando…':'Actualizar'}</button></div>
    {error?<p className="error" role="alert">No se pudo cargar o actualizar la preparación. Actualiza e intenta nuevamente.</p>:null}
    {!selected?<><div className="preparation-metrics"><article><strong>{metrics.pending}</strong><span>Por preparar</span></article><article><strong>{metrics.products}</strong><span>Productos pendientes</span></article><article><strong>{metrics.ready}</strong><span>Listos para despacho</span></article></div><div className="panel preparation-queue"><header><div><h2>Cola de preparación</h2><p>Pedidos confirmados por orden de llegada</p></div><div className="view-toggle"><button className={view==='list'?'active':''} onClick={()=>setView('list')}>Lista</button><button className={view==='board'?'active':''} onClick={()=>setView('board')}>Tablero</button></div></header>{loading&&!entries.length?<LoadingState label="Cargando cola de preparación…"/>:null}<div className={`preparation-items ${view}`}>{entries.map((entry,index)=><QueueRow key={entry.order.id} entry={entry} index={index}/>)}</div>{!loading&&!entries.length?<p className="table-message">No hay pedidos pendientes de preparación.</p>:null}</div></>:
      <div className="preparation-detail"><DetailBackLink route="preparation" label="preparación"/><div className="detail-title"><div><nav>E-commerce / Operaciones / Preparación</nav><h1>Preparar pedido {selected.order.number}</h1><p>{customerName(selected.order)}</p></div><StatusBadge tone={stageLabel(selected.stage)[1]}>{stageLabel(selected.stage)[0]}</StatusBadge></div><div className="preparation-detail-progress"><span><small>Progreso de preparación</small><strong>{selected.items.filter(item=>item.status==='DONE').length} de {selected.items.length} productos listos</strong></span><b>{progressOf(selected)}%</b><i><span style={{width:`${progressOf(selected)}%`}}/></i></div><div className="preparation-detail-grid"><section className="ops-detail-card"><header><div><h2>{selected.stage==='IN_PROGRESS'?'1. Confirma los productos':'Productos del pedido'}</h2><p>{selected.stage==='NOT_STARTED'?'Inicia la preparación para confirmar los productos.':'Verifica cantidad y producto antes de confirmarlo como listo.'}</p></div><strong>{selected.items.filter(item=>item.status==='DONE').length}/{selected.items.length}</strong></header><div className="preparation-checklist">{selected.items.map(item=><article key={item.line_id}><span className={`check ${item.status==='DONE'||selected.stage==='READY'?'done':''}`}>{item.status==='DONE'||selected.stage==='READY'?'✓':'○'}</span><span><strong>{item.line?.product_name||'Producto'}</strong><small>SKU: {item.line?.product_code||'—'} · Cantidad: {item.line?.quantity||0}</small></span><span><small>{money(item.line?.unit_price||0,selected.order.currency)}</small><b>{money(item.line?.subtotal||0,selected.order.currency)}</b></span>{write&&selected.stage==='IN_PROGRESS'?<button className="secondary" disabled={busy} onClick={()=>mark(item)}>{item.status==='DONE'?'Deshacer':'Confirmar listo'}</button>:null}</article>)}</div><CompletionStep entry={selected} write={write} busy={busy} complete={complete}/></section><div className="preparation-side"><NextStep entry={selected} write={write} busy={busy} start={()=>void start()} complete={complete}/><section className="ops-detail-card preparation-summary"><header><h2>Resumen del pedido</h2></header><dl><dt>Pedido</dt><dd><a href={detailHref('orders',selected.order.id)}>{selected.order.number}</a></dd><dt>Cliente</dt><dd>{customerName(selected.order)}</dd><dt>Productos</dt><dd>{selected.items.length} {selected.items.length===1?'producto':'productos'}</dd><dt>Total</dt><dd>{money(selected.order.total,selected.order.currency)}</dd><dt>Nodo</dt><dd>{nodes[selected.preparation?.node_id||selected.order.branch_id]||'Nodo del pedido'}</dd></dl></section></div></div></div>}
  </section>;
}
