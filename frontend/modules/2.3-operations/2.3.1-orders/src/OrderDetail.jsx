import React from 'react';
import { FLOW, NEXT, dateTime, money, statusLabel } from './orderView.js';

function Progress({ status }) {
  const current = FLOW.indexOf(status);
  return <div className="order-progress" aria-label={`Progreso: ${statusLabel(status)}`}>
    {FLOW.map((step, index) => <div className={index <= current ? 'done' : ''} key={step}><i>{index < current ? '✓' : index + 1}</i><span>{statusLabel(step)}</span></div>)}
  </div>;
}

export default function OrderDetail({ order, writable, transition, close }) {
  const delivery = order.delivery_snapshot || {}, customer = order.customer_snapshot || {}, payment = order.payment_snapshot || {};
  return <aside className="order-detail">
    <div className="detail-toolbar"><button className="quiet" onClick={close}>← Volver</button><span>Creado {dateTime(order.created_at)}</span></div>
    <div className="detail-head"><div><small>PEDIDO {order.number}</small><h2>{statusLabel(order.status)}</h2><p>Actualizado {dateTime(order.updated_at)}</p></div><strong>{money(order.total, order.currency)}</strong></div>
    {order.status === 'CANCELLED' ? <p className="cancelled-note">Este pedido fue cancelado y su ciclo operativo terminó.</p> : <Progress status={order.status} />}
    <div className="detail-grid">
      <section><small>CLIENTE</small><h3>{customer.name || order.customer_id}</h3><p>{customer.email || customer.phone || 'Sin contacto en la instantánea'}</p></section>
      <section><small>ENTREGA</small><h3>{delivery.address || 'Dirección no disponible'}</h3><p>{order.delivery_method === 'scheduled' ? 'Entrega programada' : 'Entrega en tiempo real'} · {order.delivery_window_ref}</p></section>
      <section><small>PAGO</small><h3>{payment.method || 'Sin método'}</h3><p>{payment.status || 'Estado pendiente'}</p></section>
      <section><small>OPERACIÓN</small><h3>{order.items.length} línea{order.items.length === 1 ? '' : 's'}</h3><p>Sucursal {order.branch_id}</p></section>
    </div>
    <section className="products-detail"><div className="section-heading"><h3>Productos</h3><span>{order.items.reduce((sum, item) => sum + Number(item.quantity), 0)} unidades</span></div>
      <div className="product-table">{order.items.map(item => <div key={item.id || item.position}><span><strong>{item.product_name}</strong><small>{money(item.unit_price, order.currency)} × {item.quantity}</small></span><b>{money(item.subtotal, order.currency)}</b></div>)}</div>
      <dl className="totals"><div><dt>Subtotal</dt><dd>{money(order.subtotal, order.currency)}</dd></div><div><dt>Entrega</dt><dd>{money(order.delivery_fee, order.currency)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(order.total, order.currency)}</dd></div></dl>
    </section>
    <div className="actions">{writable ? (NEXT[order.status] || []).map(value => <button key={value} className={value === 'CANCELLED' ? 'danger' : 'primary'} onClick={() => transition(value)}>{value === 'CANCELLED' ? 'Cancelar pedido' : `Marcar: ${statusLabel(value)}`}</button>) : <span>Acceso de solo lectura</span>}{writable && !(NEXT[order.status] || []).length ? <span>Ciclo finalizado</span> : null}</div>
  </aside>;
}
