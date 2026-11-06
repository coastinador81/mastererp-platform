import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './style.css';
import './directory.css';
import OrderDetail from './OrderDetail.jsx';
import FinanceIcon from '../../../2.2-finance/src/FinanceIcon.jsx';
import { NEXT, STATUS, dateTime, money, statusLabel } from './orderView.js';

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
  const [selected, setSelected] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const writable = runtime.permissions?.includes('operations.orders.write') ?? true;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const rows = (await call(runtime, `/v1/companies/${runtime.company}/orders?limit=100`)).items; setItems(rows); setSelected(current => current && rows.find(row => row.id === current.id) || null); }
    catch (problem) { setError(problem.message); } finally { setLoading(false); }
  }, [runtime]);
  useEffect(() => { if (runtime.api && runtime.tenant && runtime.company) load(); }, [runtime.api, runtime.tenant, runtime.company, load]);
  const visible = useMemo(() => items.filter(order => {
    const term = query.trim().toLowerCase();
    const text = `${order.number} ${order.customer_snapshot?.name || ''} ${order.customer_snapshot?.email || ''}`.toLowerCase();
    return (!status || order.status === status) && (!term || text.includes(term));
  }), [items, query, status]);
  async function transition(nextStatus) {
    if (!(NEXT[selected.status] || []).includes(nextStatus)) return;
    const reason = window.prompt(`Motivo para cambiar a ${statusLabel(nextStatus)}`, 'MANUAL_OPERATION'); if (!reason) return;
    try { setSelected(await call(runtime, `/v1/companies/${runtime.company}/orders/${selected.id}/transitions`, { method: 'POST', body: JSON.stringify({ version: selected.version, status: nextStatus, reason }) })); await load(); }
    catch (problem) { setError(problem.message); }
  }
  return <section className="canonical-module orders-module supplier-directory orders-directory">
    <div className="page-heading"><div><nav className="supplier-breadcrumb" aria-label="Ruta de navegación"><span>E-commerce</span><span>/</span><span className="current">Operaciones</span></nav><h1>Pedidos</h1><p className="supplier-subtitle">Gestiona los pedidos de tu tienda.</p></div><button onClick={load} disabled={loading}>{loading ? 'Actualizando…' : 'Actualizar'}</button></div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {selected ? <OrderDetail order={selected} writable={writable} transition={transition} close={() => setSelected(null)} /> : <>
      <div className="panel supplier-directory-panel"><div className="orders-filters"><label className="supplier-search"><FinanceIcon name="search"/><input type="search" aria-label="Buscar pedidos" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por pedido, cliente o correo" /></label><label className="orders-status-filter">Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option>{Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label></div>
        <div className="table-scroll"><table className="suppliers-table orders-directory-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Fecha</th><th>Estado</th><th>Total</th><th>Acción</th></tr></thead><tbody>{visible.map(order => <tr key={order.id}><td><strong>{order.number}</strong><small>{order.delivery_method === 'scheduled' ? 'Programado' : 'Entrega directa'}</small></td><td><strong>{order.customer_snapshot?.name || 'Cliente del pedido'}</strong><small>{order.customer_snapshot?.email || order.customer_snapshot?.phone || 'Sin contacto'}</small></td><td>{dateTime(order.created_at)}</td><td><b className={`status ${STATUS[order.status]?.tone || 'neutral'}`}>{statusLabel(order.status)}</b></td><td>{money(order.total, order.currency)}</td><td><button className="orders-open secondary" onClick={() => setSelected(order)}>Ver detalle</button></td></tr>)}</tbody></table></div>
        {loading ? <p className="table-message">Cargando pedidos…</p> : !visible.length ? <p className="table-message">No hay pedidos para este filtro.</p> : <p className="orders-count">{visible.length} de {items.length} pedidos</p>}
      </div>
    </>}
  </section>;
}
