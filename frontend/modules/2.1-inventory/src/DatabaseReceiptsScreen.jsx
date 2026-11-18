import React, { useEffect, useMemo, useState } from 'react';
import { loadPurchaseOrder, loadPurchaseOrders, sessionErrorMessage } from './inventory-receipts-api.js';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-VE');
}

function AccessPanel({ session, onLogin, onLogout, onTenantChange, onCompanyChange, onRetry }) {
  if (session.status === 'loading') {
    return <div className="inventory-receipt-access" role="status">Comprobando la sesión de Inventario…</div>;
  }
  if (session.status === 'signed-out') {
    return <div className="inventory-receipt-access">
      <p>Inicia sesión con tu cuenta MasterERP para consultar las órdenes de esta empresa.</p>
      <button type="button" className="inventory-receipt-primary" onClick={onLogin}>Iniciar sesión</button>
    </div>;
  }
  if (session.status === 'error') {
    return <div className="inventory-receipt-access" role="alert">
      <p>{session.error}</p>
      <button type="button" onClick={onRetry}>Reintentar</button>
    </div>;
  }
  if (!session.spaces.length) {
    return <div className="inventory-receipt-access" role="status">
      <p>Tu cuenta no tiene espacios de MasterERP asignados.</p>
      <button type="button" onClick={onLogout}>Cerrar sesión</button>
    </div>;
  }
  const companies = session.context?.companies || [];
  return <div className="inventory-receipt-access">
    {session.spaces.length > 1
      ? <label><span>Espacio</span><select value={session.tenantId} onChange={event => onTenantChange(event.target.value)}>
        <option value="">Selecciona un espacio</option>
        {session.spaces.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
      </select></label>
      : <span className="inventory-receipt-context">{session.spaces[0].name}</span>}
    {session.tenantId && companies.length > 1
      ? <label><span>Empresa</span><select value={session.companyId} onChange={event => onCompanyChange(event.target.value)}>
        <option value="">Selecciona una empresa</option>
        {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select></label>
      : session.companyId && companies.length === 1
        ? <span className="inventory-receipt-context">{companies[0].name}</span>
        : null}
    {session.tenantId && !companies.length && <span className="inventory-receipt-context">No hay empresas autorizadas para consultar Compras.</span>}
    <button type="button" className="inventory-receipt-logout" onClick={onLogout}>Cerrar sesión</button>
  </div>;
}

export default function DatabaseReceiptsScreen({
  view,
  session,
  onLogin,
  onLogout,
  onTenantChange,
  onCompanyChange,
  onRetrySession,
  onAuthExpired,
}) {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const isPending = view === 'recepciones-pendientes';

  useEffect(() => {
    if (!isPending || session.status !== 'signed-in' || !session.tenantId || !session.companyId) {
      setOrders([]);
      setLoadError('');
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    setSelectedId('');
    setSelectedOrder(null);
    loadPurchaseOrders(session.tenantId, session.companyId, controller.signal)
      .then(items => { if (!controller.signal.aborted) setOrders(items); })
      .catch(error => { if (!controller.signal.aborted) { if (error?.status === 401) onAuthExpired(); else setLoadError(sessionErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [isPending, session.status, session.tenantId, session.companyId, refreshKey]);

  useEffect(() => {
    if (!selectedId || !session.tenantId || !session.companyId) {
      setSelectedOrder(null);
      return undefined;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    loadPurchaseOrder(session.tenantId, session.companyId, selectedId, controller.signal)
      .then(order => { if (!controller.signal.aborted) setSelectedOrder(order); })
      .catch(error => { if (!controller.signal.aborted) { if (error?.status === 401) onAuthExpired(); else setLoadError(sessionErrorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedId, session.tenantId, session.companyId]);

  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const rows = useMemo(() => orders.filter(order => {
    const haystack = `${order.number || ''} ${order.supplier || ''} ${order.status || ''}`.toLocaleLowerCase('es');
    return (!search || haystack.includes(search.trim().toLocaleLowerCase('es')))
      && (!dateFrom || order.date >= dateFrom)
      && (!dateTo || order.date <= dateTo);
  }), [orders, search, dateFrom, dateTo]);
  const title = isPending ? 'Órdenes pendientes de recepción' : 'Recepciones recibidas';

  if (!isPending) {
    return <section className="inventory-panel inventory-products">
      <div className="inventory-products-heading"><div>
        <p className="inventory-tactical-kicker">INVENTARIO · RECEPCIONES</p>
        <h2>{title}</h2>
        <p>Las órdenes se consultan en Compras; aquí aparecerán cuando Inventario registre su recepción.</p>
      </div></div>
      <div className="inventory-products-empty"><h3>Aún no hay recepciones registradas</h3><p>La consulta de órdenes no registra ni marca mercancía como recibida.</p></div>
    </section>;
  }

  return <section className="inventory-panel inventory-products">
    <div className="inventory-products-heading"><div>
      <p className="inventory-tactical-kicker">INVENTARIO · RECEPCIONES</p>
      <h2>{title}</h2>
      <p>Órdenes de compra leídas desde Finanzas. Consultar esta lista no modifica existencias.</p>
    </div><button type="button" className="inventory-receipt-refresh" disabled={loading || !session.companyId} onClick={() => setRefreshKey(value => value + 1)}>Actualizar</button></div>
    <AccessPanel session={session} onLogin={onLogin} onLogout={onLogout} onTenantChange={onTenantChange} onCompanyChange={onCompanyChange} onRetry={onRetrySession}/>
    {session.status === 'signed-in' && session.companyId && <>
      <div className="inventory-product-filters">
        <label className="inventory-product-search"><span className="inventory-filter-label">Buscar orden o proveedor</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Ej. OC-2026-094"/></label>
        <label className="inventory-product-date-filter"><span>Orden desde</span><input type="date" value={dateFrom} max={dateTo || undefined} onChange={event => setDateFrom(event.target.value)}/></label>
        <label className="inventory-product-date-filter"><span>Orden hasta</span><input type="date" value={dateTo} min={dateFrom || undefined} onChange={event => setDateTo(event.target.value)}/></label>
        <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }} disabled={!dateFrom && !dateTo}>Restablecer fechas</button>
        <span className="inventory-products-scope">{loading ? 'Consultando…' : `${rows.length} órdenes`}</span>
      </div>
      {invalidDateRange && <p className="inventory-date-error" role="alert">La fecha inicial debe ser anterior o igual a la fecha final.</p>}
      {loadError && <p className="inventory-date-error" role="alert">{loadError}</p>}
      <div className="inventory-table-scroll" role="region" aria-label="Órdenes de compra pendientes de recepción" tabIndex={0}>
        <table><caption className="inventory-sr-only">Órdenes de compra leídas desde Compras</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Orden de compra</th><th scope="col">Fecha</th><th scope="col">Proveedor</th><th scope="col">Estado en Compras</th><th scope="col">Recepción</th></tr></thead>
          <tbody>{loading
            ? <tr><td colSpan="6"><div className="inventory-products-empty" role="status"><h3>Cargando órdenes</h3><p>Consultando Compras para la empresa seleccionada…</p></div></td></tr>
            : rows.length ? rows.map((order, index) => <tr key={order.id} className="inventory-product-row" onClick={() => setSelectedId(current => current === order.id ? '' : order.id)}>
              <td className="inventory-product-row-number">{index + 1}</td>
              <th scope="row"><button type="button" className="inventory-product-name-button" aria-expanded={selectedId === order.id} onClick={event => { event.stopPropagation(); setSelectedId(current => current === order.id ? '' : order.id); }}><strong>{order.number || 'Sin número'}</strong><small>Ver líneas y validación →</small></button></th>
              <td>{formatDate(order.date)}</td><td>{order.supplier || '—'}</td>
              <td><span className="inventory-product-status inventory-product-status-warning">{order.status || 'Sin estado'}</span></td>
              <td><span className={'inventory-product-status '+(order.receipt_validation?.receipt_eligible ? 'inventory-product-status-good' : 'inventory-product-status-warning')}>{order.receipt_validation?.receipt_eligible ? 'Lista para recibir' : 'Requiere validación'}</span></td>
            </tr>)
              : <tr><td colSpan="6"><div className="inventory-products-empty"><h3>{search || dateFrom || dateTo ? 'Sin órdenes con estos filtros' : 'No hay órdenes de compra'}</h3><p>{search || dateFrom || dateTo ? 'Ajusta la búsqueda o el rango de fechas.' : 'No se encontraron órdenes disponibles para esta empresa.'}</p></div></td></tr>}
          </tbody>
        </table>
      </div>
      {selectedId && <section className="inventory-receipt-detail" aria-label="Detalle de la orden seleccionada">
        {detailLoading ? <p role="status">Cargando líneas de la orden…</p> : selectedOrder && <>
          <div className="inventory-products-heading"><div><p className="inventory-tactical-kicker">DETALLE DE LA ORDEN</p><h3>{selectedOrder.number || 'Orden de compra'}</h3><p>{selectedOrder.supplier || 'Proveedor sin identificar'} · {formatDate(selectedOrder.date)}</p></div></div>
          <div className="inventory-table-scroll"><table><caption className="inventory-sr-only">Productos y cantidades de la orden de compra</caption><thead><tr><th scope="col">#</th><th scope="col">Producto o descripción</th><th scope="col">Cantidad ordenada</th></tr></thead><tbody>{(selectedOrder.lines || []).map((line, index) => <tr key={`${selectedOrder.id}-${index}`}><td className="inventory-product-row-number">{index + 1}</td><th scope="row">{line.description || line.product_id || 'Producto sin descripción'}</th><td>{line.quantity_ordered ?? '—'}</td></tr>)}{!selectedOrder.lines?.length && <tr><td colSpan="3">La orden no contiene líneas visibles.</td></tr>}</tbody></table></div>
          {selectedOrder.receipt_validation?.reasons?.length > 0 && <div className="inventory-receipt-validation"><strong>Validación de recepción pendiente</strong><ul>{selectedOrder.receipt_validation.reasons.map(reason => <li key={reason.code}>{reason.message}</li>)}</ul></div>}
        </>}
      </section>}
    </>}
  </section>;
}
