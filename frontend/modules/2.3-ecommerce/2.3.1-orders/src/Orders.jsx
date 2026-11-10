import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './style.css';
import './directory.css';
import OrderDetail from './OrderDetail.jsx';
import FinanceIcon from '../../../2.2-finance/src/FinanceIcon.jsx';
import StatusBadge from '../../../../shared/status-badge/StatusBadge.jsx';
import LoadingState from '../../../../shared/loading-state/LoadingState.jsx';
import { NEXT, STATUS, dateTime, money, paymentMethodLabel, statusLabel } from './orderView.js';
import {closeDetail,detailFromHash,openDetail} from '../../src/operationView.mjs';

async function call(runtime, path, options = {}) {
  const headers = { 'X-Tenant-Id': runtime.tenant, 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (runtime.request) return runtime.request(runtime.api + path, { ...options, headers });
  const token = await window.mastererpAuth?.getAccessToken?.();
  if (!token) throw new Error('Sesión autenticada no disponible.');
  const response = await fetch(runtime.api + path, { ...options, headers: { ...headers, Authorization: `Bearer ${token}` } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Error ${response.status}`);
  return body;
}

export default function Orders({ runtime }) {
  const [items, setItems] = useState([]), [status, setStatus] = useState(''), [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null), [checked, setChecked] = useState([]), [bulkAction, setBulkAction] = useState(''), [ascending, setAscending] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [nodes, setNodes] = useState({});
  const [moreFilters,setMoreFilters]=useState(false),[payment,setPayment]=useState(''),[dateFrom,setDateFrom]=useState(''),[dateTo,setDateTo]=useState(''),[page,setPage]=useState(1);
  const writable = runtime.permissions?.includes('operations.orders.write') ?? true;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const requested=detailFromHash('orders'), canReadNodes=runtime.permissions?.includes('operations.nodes.read');
      const [rows,nodeRows]=await Promise.all([call(runtime, `/v1/companies/${runtime.company}/orders?limit=100`).then(value=>value.items),requested&&canReadNodes?call(runtime,`/v1/companies/${runtime.company}/nodes`).then(value=>value.items).catch(()=>[]):[]]);
      setItems(rows); setNodes(Object.fromEntries(nodeRows.map(node=>[node.id,node.name]))); setSelected(requested ? rows.find(row=>row.id===requested)||await call(runtime,`/v1/companies/${runtime.company}/orders/${requested}`) : null); }
    catch (problem) { setError(problem.message); } finally { setLoading(false); }
  }, [runtime]);
  useEffect(() => { if (runtime.api && runtime.tenant && runtime.company) load(); }, [runtime.api, runtime.tenant, runtime.company, load]);
  const visible = useMemo(() => items.filter(order => {
    const term = query.trim().toLowerCase();
    const text = `${order.number} ${order.customer_snapshot?.name || ''} ${order.customer_snapshot?.email || ''}`.toLowerCase();
    const created=String(order.created_at||'').slice(0,10);
    return (!status || order.status === status) && (!payment||order.payment_snapshot?.method===payment) && (!dateFrom||created>=dateFrom) && (!dateTo||created<=dateTo) && (!term || text.includes(term));
  }).sort((a,b)=>(ascending?1:-1)*(new Date(a.created_at).getTime()-new Date(b.created_at).getTime())), [items, query, status, payment, dateFrom, dateTo, ascending]);
  const pageSize=10,totalPages=Math.max(1,Math.ceil(visible.length/pageSize)),pageItems=visible.slice((Math.min(page,totalPages)-1)*pageSize,Math.min(page,totalPages)*pageSize);
  useEffect(()=>setPage(1),[query,status,payment,dateFrom,dateTo]);
  async function transition(nextStatus) {
    if (!(NEXT[selected.status] || []).includes(nextStatus)) return;
    const reason = window.prompt(`Motivo para cambiar a ${statusLabel(nextStatus)}`, 'MANUAL_OPERATION'); if (!reason) return;
    try { setSelected(await call(runtime, `/v1/companies/${runtime.company}/orders/${selected.id}/transitions`, { method: 'POST', body: JSON.stringify({ version: selected.version, status: nextStatus, reason }) })); await load(); }
    catch (problem) { setError(problem.message); }
  }
  async function applyBulk(){
    const orders=items.filter(order=>checked.includes(order.id)&&(NEXT[order.status]||[]).includes(bulkAction));
    if(!bulkAction||!orders.length)return;
    if(orders.length!==checked.length){setError('La acción no es válida para todos los pedidos seleccionados. Filtra por estado e inténtalo nuevamente.');return;}
    const reason=window.prompt(`Motivo para cambiar ${orders.length} pedidos a ${statusLabel(bulkAction)}`,'OPERACION_AGRUPADA');if(!reason)return;
    try{await Promise.all(orders.map(order=>call(runtime,`/v1/companies/${runtime.company}/orders/${order.id}/transitions`,{method:'POST',body:JSON.stringify({version:order.version,status:bulkAction,reason})})));setChecked([]);setBulkAction('');await load();}
    catch(problem){setError(problem.message);}
  }
  return <section className="canonical-module orders-module supplier-directory orders-directory">
    <div className="page-heading"><div><nav className="supplier-breadcrumb" aria-label="Ruta de navegación"><span>E-commerce</span><span>/</span><span className="current">Operaciones</span></nav><h1>Pedidos</h1><p className="supplier-subtitle">Consulta y gestiona el ciclo operativo de cada pedido.</p></div><button onClick={load} disabled={loading}>{loading ? 'Sincronizando…' : 'Sincronizar pedidos'}</button></div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {selected ? <OrderDetail order={selected} writable={writable} transition={transition} close={() => closeDetail('orders')} nodeName={nodes[selected.branch_id]} customerOrders={items.filter(order=>order.customer_id===selected.customer_id)} canOpenCustomer={runtime.permissions?.includes('administration.parties.read')} /> : loading && detailFromHash('orders') ? <LoadingState label="Cargando pedido…"/> : <>
      <div className="panel supplier-directory-panel"><div className="orders-list-title"><div><h2>Todos los pedidos <span>{items.length}</span></h2><small>Información operativa actual</small></div></div><div className="orders-filters"><label className="supplier-search"><FinanceIcon name="search"/><input type="search" aria-label="Buscar pedidos" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por pedido, cliente o correo…" /></label><label className="orders-status-filter"><span className="sr-only">Estado</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option>{Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label><button className="secondary" onClick={()=>setMoreFilters(value=>!value)} aria-expanded={moreFilters}>Más filtros</button></div>{moreFilters?<div className="orders-advanced"><label>Desde<input type="date" value={dateFrom} onChange={event=>setDateFrom(event.target.value)}/></label><label>Hasta<input type="date" value={dateTo} onChange={event=>setDateTo(event.target.value)}/></label><label>Método de pago<select value={payment} onChange={event=>setPayment(event.target.value)}><option value="">Todos</option><option value="cash">Efectivo</option><option value="mobile_payment">Pago móvil</option><option value="card">Tarjeta</option><option value="transfer">Transferencia</option></select></label></div>:null}<div className="orders-bulk"><span>{checked.length} seleccionados</span><select aria-label="Acción agrupada" value={bulkAction} onChange={event=>setBulkAction(event.target.value)}><option value="">Acciones agrupadas</option><option value="CONFIRMED">Confirmar</option><option value="PREPARING">Marcar en preparación</option><option value="READY">Marcar listo</option><option value="OUT_FOR_DELIVERY">Marcar en ruta</option><option value="DELIVERED">Marcar entregado</option><option value="CANCELLED">Cancelar</option></select><button className="secondary" disabled={!checked.length||!bulkAction} onClick={applyBulk}>Aplicar</button></div>
        <div className="table-scroll"><table className="suppliers-table orders-directory-table prestashop-orders-table"><thead><tr><th><input type="checkbox" aria-label="Seleccionar todos" checked={pageItems.length>0&&pageItems.every(order=>checked.includes(order.id))} onChange={event=>setChecked(event.target.checked?[...new Set([...checked,...pageItems.map(order=>order.id)])]:checked.filter(id=>!pageItems.some(order=>order.id===id)))}/></th><th>Pedido</th><th>Cliente</th><th>Productos</th><th>Pago</th><th>Total</th><th>Estado</th><th><button className="sort-button" onClick={()=>setAscending(!ascending)}>Fecha {ascending?'↑':'↓'}</button></th><th><span className="sr-only">Ver</span></th></tr></thead><tbody>{pageItems.map(order => <tr key={order.id} className="order-clickable-row" onClick={event=>{if(!event.target.closest('a,button,input,label,select'))openDetail('orders',order.id);}}><td><input type="checkbox" aria-label={`Seleccionar pedido ${order.number}`} checked={checked.includes(order.id)} onChange={event=>setChecked(current=>event.target.checked?[...new Set([...current,order.id])]:current.filter(id=>id!==order.id))}/></td><td><a className="order-number-link" href={`#/orders/${encodeURIComponent(order.id)}/view`}>{order.number}</a></td><td><span className="customer-cell"><i>{(order.customer_snapshot?.name||'C').split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()}</i><span><strong>{order.customer_snapshot?.name || 'Cliente del pedido'}</strong><small>{order.customer_snapshot?.email || order.customer_snapshot?.phone || 'Sin contacto'}</small></span></span></td><td>{order.items.reduce((sum,item)=>sum+Number(item.quantity||0),0)} productos</td><td>{paymentMethodLabel(order.payment_snapshot?.method,order.payment_snapshot)}</td><td><strong>{money(order.total, order.currency)}</strong></td><td><StatusBadge status={order.status}>{statusLabel(order.status)}</StatusBadge></td><td>{dateTime(order.created_at)}</td><td><a className="row-chevron" href={`#/orders/${encodeURIComponent(order.id)}/view`} aria-label={`Ver detalle del pedido ${order.number}`}>›</a></td></tr>)}</tbody></table></div>
        {loading ? <LoadingState label="Cargando pedidos…"/> : !visible.length ? <p className="table-message">No hay pedidos para este filtro.</p> : <footer className="orders-footer"><span>Mostrando {pageItems.length} de {visible.length} pedidos</span><div><button disabled={page<=1} onClick={()=>setPage(value=>value-1)}>Anterior</button><b>{Math.min(page,totalPages)}</b><button disabled={page>=totalPages} onClick={()=>setPage(value=>value+1)}>Siguiente</button></div></footer>}
      </div>
    </>}
  </section>;
}
