import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './style.css';
import './directory.css';
import OrderDetail from './OrderDetail.jsx';
import FinanceIcon from '../../../2.2-finance/src/FinanceIcon.jsx';
import { NEXT, STATUS, dateTime, money, paymentMethodLabel, statusLabel } from './orderView.js';
import {closeDetail,detailFromHash} from '../../src/operationView.mjs';

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
  const [selected, setSelected] = useState(null), [checked, setChecked] = useState([]), [bulkAction, setBulkAction] = useState(''), [ascending, setAscending] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const writable = runtime.permissions?.includes('operations.orders.write') ?? true;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const rows = (await call(runtime, `/v1/companies/${runtime.company}/orders?limit=100`)).items, requested=detailFromHash('orders'); setItems(rows); setSelected(requested ? rows.find(row=>row.id===requested)||await call(runtime,`/v1/companies/${runtime.company}/orders/${requested}`) : null); }
    catch (problem) { setError(problem.message); } finally { setLoading(false); }
  }, [runtime]);
  useEffect(() => { if (runtime.api && runtime.tenant && runtime.company) load(); }, [runtime.api, runtime.tenant, runtime.company, load]);
  const visible = useMemo(() => items.filter(order => {
    const term = query.trim().toLowerCase();
    const text = `${order.number} ${order.customer_snapshot?.name || ''} ${order.customer_snapshot?.email || ''}`.toLowerCase();
    return (!status || order.status === status) && (!term || text.includes(term));
  }).sort((a,b)=>(ascending?1:-1)*String(a.number).localeCompare(String(b.number),undefined,{numeric:true})), [items, query, status, ascending]);
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
    <div className="page-heading"><div><nav className="supplier-breadcrumb" aria-label="Ruta de navegación"><span>E-commerce</span><span>/</span><span className="current">Operaciones</span></nav><h1>Pedidos</h1><p className="supplier-subtitle">Gestiona los pedidos de tu tienda.</p></div><button onClick={load} disabled={loading}>{loading ? 'Actualizando…' : 'Actualizar'}</button></div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {selected ? <OrderDetail order={selected} writable={writable} transition={transition} close={() => closeDetail('orders')} /> : <>
      <div className="panel supplier-directory-panel"><div className="orders-list-title"><h2>Pedidos ({items.length})</h2><span>{checked.length} seleccionados</span></div><div className="orders-bulk"><select aria-label="Acción agrupada" value={bulkAction} onChange={event=>setBulkAction(event.target.value)}><option value="">Acciones agrupadas</option><option value="CONFIRMED">Confirmar</option><option value="PREPARING">Marcar en preparación</option><option value="READY">Marcar listo</option><option value="OUT_FOR_DELIVERY">Marcar en ruta</option><option value="DELIVERED">Marcar entregado</option><option value="CANCELLED">Cancelar</option></select><button className="secondary" disabled={!checked.length||!bulkAction} onClick={applyBulk}>Aplicar</button></div><div className="orders-filters"><label className="supplier-search"><FinanceIcon name="search"/><input type="search" aria-label="Buscar pedidos" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar referencia, cliente o correo" /></label><label className="orders-status-filter">Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option>{Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label></div>
        <div className="table-scroll"><table className="suppliers-table orders-directory-table prestashop-orders-table"><thead><tr><th><input type="checkbox" aria-label="Seleccionar todos" checked={visible.length>0&&checked.length===visible.length} onChange={event=>setChecked(event.target.checked?visible.map(order=>order.id):[])}/></th><th><button className="sort-button" onClick={()=>setAscending(!ascending)}>ID {ascending?'↑':'↓'}</button></th><th>Referencia</th><th>Nuevo cliente</th><th>Entrega</th><th>Cliente</th><th>Total</th><th>Pago</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead><tbody>{visible.map(order => <tr key={order.id}><td><input type="checkbox" aria-label={`Seleccionar pedido ${order.number}`} checked={checked.includes(order.id)} onChange={event=>setChecked(current=>event.target.checked?[...current,order.id]:current.filter(id=>id!==order.id))}/></td><td><strong>{order.number}</strong></td><td>{order.external_reference||order.number}</td><td>{order.customer_snapshot?.is_new||order.customer_snapshot?.new_customer?'Sí':'No'}</td><td>{order.delivery_snapshot?.country||order.delivery_snapshot?.city||'Por confirmar'}</td><td><strong>{order.customer_snapshot?.name || 'Cliente del pedido'}</strong><small>{order.customer_snapshot?.email || order.customer_snapshot?.phone || 'Sin contacto'}</small></td><td><strong>{money(order.total, order.currency)}</strong></td><td>{paymentMethodLabel(order.payment_snapshot?.method)}</td><td><b className={`status ${STATUS[order.status]?.tone || 'neutral'}`}>{statusLabel(order.status)}</b></td><td>{dateTime(order.created_at)}</td><td><div className="order-actions"><a href={`#/orders/${encodeURIComponent(order.id)}/view`} title="Ver detalle">Detalle</a><a href={`#/preparation/${encodeURIComponent(order.id)}/view`} title="Abrir preparación">Preparación</a></div></td></tr>)}</tbody></table></div>
        {loading ? <p className="table-message">Cargando pedidos…</p> : !visible.length ? <p className="table-message">No hay pedidos para este filtro.</p> : <p className="orders-count">{visible.length} de {items.length} pedidos</p>}
      </div>
    </>}
  </section>;
}
