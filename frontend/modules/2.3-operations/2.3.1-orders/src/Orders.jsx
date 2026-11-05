import React,{useCallback,useEffect,useState} from 'react';
import './style.css';

const LABELS={PENDING:'Pendiente',CONFIRMED:'Confirmado',PREPARING:'En preparación',READY:'Listo',OUT_FOR_DELIVERY:'En reparto',DELIVERED:'Entregado',CANCELLED:'Cancelado'};
const NEXT={PENDING:['CONFIRMED','CANCELLED'],CONFIRMED:['PREPARING','CANCELLED'],PREPARING:['READY','CANCELLED'],READY:['OUT_FOR_DELIVERY'],OUT_FOR_DELIVERY:['DELIVERED']};

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

export default function Orders({runtime}) {
  const [items,setItems]=useState([]),[status,setStatus]=useState(''),[selected,setSelected]=useState(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const writable=runtime.permissions?.includes('operations.orders.write')??true;
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{const query=status?`?status=${encodeURIComponent(status)}`:'';const rows=(await call(runtime,`/v1/companies/${runtime.company}/orders${query}`)).items;setItems(rows);setSelected(current=>current&&rows.find(row=>row.id===current.id)||null);}
    catch(problem){setError(problem.message);}finally{setLoading(false);}
  },[runtime,status]);
  useEffect(()=>{if(runtime.api&&runtime.tenant&&runtime.company)load();},[runtime.api,runtime.tenant,runtime.company]);
  async function transition(nextStatus){
    const reason=window.prompt(`Motivo para cambiar a ${LABELS[nextStatus]}`,'MANUAL_OPERATION');if(!reason)return;
    try{setSelected(await call(runtime,`/v1/companies/${runtime.company}/orders/${selected.id}/transitions`,{method:'POST',body:JSON.stringify({version:selected.version,status:nextStatus,reason})}));await load();}
    catch(problem){setError(problem.message);}
  }
  return <section className="canonical-module orders-module"><header><div><small>OPERACIONES</small><h1>Pedidos</h1><p>Control manual de pedidos y su ciclo operativo.</p></div><button onClick={load}>Actualizar</button></header>
    <div className="toolbar"><label>Estado<select value={status} onChange={event=>setStatus(event.target.value)}><option value="">Todos</option>{Object.entries(LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><span>{items.length} pedidos</span></div>
    {error&&<p className="error" role="alert">{error}</p>}<div className="layout"><div className="list">{loading?<p>Cargando…</p>:items.map(order=><button className={`card ${selected?.id===order.id?'active':''}`} key={order.id} onClick={()=>setSelected(order)}><span><strong>{order.number}</strong><small>{order.customer_snapshot?.name||order.customer_id}</small></span><span><b className={`badge ${order.status}`}>{LABELS[order.status]||order.status}</b><strong>{money(order.total,order.currency)}</strong></span></button>)}{!loading&&!items.length&&<p className="empty">No hay pedidos para este filtro.</p>}</div><aside>{selected?<OrderDetail order={selected} writable={writable} transition={transition}/>:<p className="empty">Selecciona un pedido para ver el detalle.</p>}</aside></div>
  </section>;
}

function money(value,currency){return new Intl.NumberFormat('es-VE',{style:'currency',currency}).format(Number(value));}
function OrderDetail({order,writable,transition}) {return <><div className="detail-head"><div><small>{order.number}</small><h2>{LABELS[order.status]||order.status}</h2></div><strong>{money(order.total,order.currency)}</strong></div><dl><div><dt>Cliente</dt><dd>{order.customer_snapshot?.name||order.customer_id}</dd></div><div><dt>Entrega</dt><dd>{order.delivery_snapshot?.address||order.delivery_window_ref}</dd></div><div><dt>Pago</dt><dd>{order.payment_snapshot?.method} · {order.payment_snapshot?.status}</dd></div></dl><h3>Productos</h3><ul>{order.items.map(item=><li key={item.id||item.position}><span>{item.product_name} × {item.quantity}</span><strong>{money(item.subtotal,order.currency)}</strong></li>)}</ul><div className="actions">{writable?(NEXT[order.status]||[]).map(value=><button key={value} className={value==='CANCELLED'?'danger':''} onClick={()=>transition(value)}>{LABELS[value]}</button>):<span>Acceso de solo lectura</span>}{writable&&!(NEXT[order.status]||[]).length&&<span>Ciclo finalizado</span>}</div></>}
