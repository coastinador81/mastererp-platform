import React,{useCallback,useEffect,useMemo,useRef,useState}from'react';
import LoadingState from '../../../shared/loading-state/LoadingState.jsx';
import {summarizeOperations} from './summaryView.mjs';
import FinanceIcon from '../../2.2-finance/src/FinanceIcon.jsx';
import{canOpenOperationsRoute}from'./access.mjs';
import{money,statusLabel,STATUS}from'../2.3.1-orders/src/orderView.js';
import StatusBadge from'../../../shared/status-badge/StatusBadge.jsx';

const call=(runtime,path)=>runtime.request(runtime.api+path,{headers:{'X-Tenant-Id':runtime.tenant,'Content-Type':'application/json'}});
const endpoints={orders:'orders?limit=100',preparation:'preparations?limit=100',routes:'routes?limit=100'};

export default function EcommerceSummary(props){
  const {runtime,context}=props;
  return <SummarySession key={`${runtime.api}:${runtime.tenant}:${runtime.company}:${Object.keys(endpoints).map(route=>canOpenOperationsRoute(context,route)).join(':')}`} {...props}/>;
}
function SummarySession({context,runtime,navigate}){
  const[data,setData]=useState({orders:[],preparation:[],routes:[]}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[updated,setUpdated]=useState(null);
  const refs=useRef({context,runtime}),active=useRef(false),pending=useRef(false);
  refs.current={context,runtime};
  const load=useCallback(async()=>{
    if(pending.current)return;
    const {runtime,context}=refs.current;
    if(!runtime.company){setLoading(false);setError('Selecciona una empresa para consultar su operación.');return;}
    pending.current=true;setLoading(true);setError('');
    try{
      const entries=await Promise.all(Object.entries(endpoints).map(async([route,path])=>{
        if(!canOpenOperationsRoute(context,route))return[route,[]];
        const response=await call(runtime,`/v1/companies/${runtime.company}/${path}`);
        if(!Array.isArray(response?.items))throw new Error('Invalid summary response');
        return[route,response.items];
      }));
      if(active.current){setData(Object.fromEntries(entries));setUpdated(new Date());}
    }catch{if(active.current)setError('No pudimos actualizar el resumen. Intenta de nuevo.');}
    finally{pending.current=false;if(active.current)setLoading(false);}
  },[]);
  useEffect(()=>{active.current=true;void load();const refresh=()=>{if(document.visibilityState==='visible')void load();};window.addEventListener('focus',refresh);return()=>{active.current=false;window.removeEventListener('focus',refresh);};},[load]);
  const orders=data.orders,summary=summarizeOperations(data),available=!loading&&!error&&updated;
  const value=(route,result)=>!canOpenOperationsRoute(context,route)?'Sin acceso':available?result:'—';
  const counts=useMemo(()=>Object.fromEntries(Object.keys(STATUS).map(status=>[status,orders.filter(order=>order.status===status).length])),[orders]);
  const metrics=[['Pedidos de hoy',value('orders',summary.todayCount),'Recibidos desde la medianoche','order','blue'],['En preparación',value('preparation',summary.preparing),'Pedidos que se están preparando ahora','document','orange'],['En reparto',value('orders',summary.delivering),available&&canOpenOperationsRoute(context,'routes')?`${summary.activeRoutes} ${summary.activeRoutes===1?'ruta activa':'rutas activas'}`:'Pedidos en camino al cliente','sales','violet'],['Importe de pedidos de hoy',value('orders',summary.amounts.map(([currency,total])=>money(total,currency)).join(' · ')||'Sin importe'),'Sin cancelados · aún no son cobros confirmados','summary','green']];
  const flow=[['CONFIRMED','Confirmados','blue'],['PREPARING','En preparación','violet'],['OUT_FOR_DELIVERY','En ruta','orange'],['DELIVERED','Entregados','green']],total=flow.reduce((sum,[key])=>sum+(counts[key]||0),0);
  const visible=[['orders','order','Gestionar pedidos','Revisa y actualiza el estado de cada pedido'],['preparation','document','Preparar productos','Organiza los pedidos antes del despacho'],['routes','sales','Planificar rutas','Consulta y organiza las entregas'],['nodes','supplier','Configurar nodos','Administra ubicaciones y capacidades']].filter(([route])=>canOpenOperationsRoute(context,route));
  return <section className="ops-modern ops-summary"><div className="ops-page-heading"><div><nav>E-commerce <span>/</span> Operaciones</nav><h1>Resumen de operaciones</h1><p>Estado actual de pedidos, preparación, rutas y nodos.</p></div><button className="ops-button secondary" onClick={()=>void load()} disabled={loading}><span aria-hidden="true">↻</span>{loading?'Actualizando…':'Actualizar'}</button></div>
    {error?<p className="notice error" role="alert">{error}</p>:null}<p>Resumen de los últimos 100 registros de cada listado; no es un total histórico.{updated&&!error&&!loading?` Actualizado a las ${updated.toLocaleTimeString('es')}.`:''}</p><div className="ops-metrics">{metrics.map(([label,value,meta,icon,tone])=><article key={label}><span className={`ops-metric-icon ${tone}`}><FinanceIcon name={icon}/></span><div><small>{label}</small><strong>{value}</strong><em>{meta}</em></div></article>)}</div>
    {loading?<LoadingState label="Actualizando resumen…"/>:null}
    {available&&canOpenOperationsRoute(context,'orders')?<>
    <div className="ops-dashboard-grid"><article className="ops-panel"><header><div><h2>Pedidos recientes</h2><p>Últimos movimientos registrados</p></div><button onClick={()=>navigate('orders')}>Ver todos →</button></header><div className="ops-recent-orders">{orders.slice(0,5).map(order=><a key={order.id} href={`#/orders/${encodeURIComponent(order.id)}/view`}><span className="ops-row-icon"><FinanceIcon name="order"/></span><span><strong>{order.number}</strong><small>{order.customer_snapshot?.name||'Cliente del pedido'} · {order.items?.length||0} productos</small></span><b>{money(order.total,order.currency)}</b><StatusBadge status={order.status}>{statusLabel(order.status)}</StatusBadge><span>›</span></a>)}{!orders.length&&!loading?<p className="ops-empty">No hay pedidos registrados.</p>:null}</div></article>
      <article className="ops-panel ops-flow"><header><div><h2>Flujo de pedidos</h2><p>Distribución actual</p></div></header><div className="ops-donut-wrap"><div className="ops-donut" style={{background:donutGradient(flow,counts,total)}}><span><strong>{total}</strong><small>pedidos</small></span></div><div className="ops-legend">{flow.map(([key,label,tone])=><span key={key}><i className={tone}/>{label}<b>{counts[key]||0}</b></span>)}</div></div>{canOpenOperationsRoute(context,'preparation')?<button className="ops-button secondary full" onClick={()=>navigate('preparation')}>Gestionar preparación</button>:null}</article></div>
    </>:null}<article className="ops-panel ops-quick"><header><div><h2>Accesos rápidos</h2><p>Continúa con tus tareas frecuentes</p></div></header><div>{visible.map(([route,icon,title,description])=><button key={route} onClick={()=>navigate(route)}><span className="ops-row-icon"><FinanceIcon name={icon}/></span><span><strong>{title}</strong><small>{description}</small></span><b>›</b></button>)}</div></article></section>;
}
function donutGradient(flow,counts,total){if(!total)return'#e8edf5';const colors={blue:'#1685eb',violet:'#7161e8',orange:'#f4a340',green:'#32b477'};let current=0;return`conic-gradient(${flow.map(([key,,tone])=>{const start=current;current+=(counts[key]||0)/total*100;return`${colors[tone]} ${start}% ${current}%`;}).join(',')})`;}
