import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './style.css';
import OrderDetail from './OrderDetail.jsx';
import OrderMetrics from './OrderMetrics.jsx';
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
  return <section className="canonical-module orders-module">
    <header className="orders-heading"><div><small>OPERACIONES · CENTRO DE PEDIDOS</small><h1>Pedidos</h1><p>Supervisa cada compra desde la confirmación hasta la entrega.</p></div><button className="refresh" onClick={load} disabled={loading}>{loading ? 'Actualizando…' : 'Actualizar'}</button></header>
    <OrderMetrics orders={items} />
    {error ? <p className="error" role="alert">{error}</p> : null}
    {selected ? <OrderDetail order={selected} writable={writable} transition={transition} close={() => setSelected(null)} /> : <>
      <div className="orders-toolbar"><label className="search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar pedido o cliente" /></label><label>Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option>{Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label><span className="result-count">{visible.length} de {items.length}</span></div>
      <div className="orders-table" role="table"><div className="table-head" role="row"><span>Pedido</span><span>Cliente</span><span>Fecha</span><span>Estado</span><span>Total</span><span aria-hidden="true" /></div>
        {loading ? <p className="table-message">Cargando pedidos…</p> : visible.map(order => <button role="row" className="order-row" key={order.id} onClick={() => setSelected(order)}><span><strong>{order.number}</strong><small>{order.delivery_method === 'scheduled' ? 'Programado' : 'Entrega directa'}</small></span><span><strong>{order.customer_snapshot?.name || order.customer_id}</strong><small>{order.customer_snapshot?.email || order.customer_snapshot?.phone || 'Sin contacto'}</small></span><span>{dateTime(order.created_at)}</span><span><b className={`status ${STATUS[order.status]?.tone || 'neutral'}`}>{statusLabel(order.status)}</b></span><span className="amount">{money(order.total, order.currency)}</span><span className="open">›</span></button>)}
        {!loading && !visible.length ? <p className="table-message">No hay pedidos para este filtro.</p> : null}
      </div>
    </>}
  </section>;
}
