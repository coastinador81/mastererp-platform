import React from 'react';
import { FLOW, NEXT, STATUS, dateTime, money, paymentMethodLabel, paymentStatusLabel, statusLabel } from './orderView.js';
import {shortReference} from '../../src/operationView.mjs';

const fieldLabels={name:'Nombre',email:'Correo',phone:'Teléfono',document:'Documento',company:'Empresa',recipient:'Recibe',address:'Dirección',address_line_1:'Dirección',address_line_2:'Complemento',city:'Ciudad',state:'Estado',postal_code:'Código postal',country:'País',reference:'Referencia',transaction_id:'Transacción',bank:'Banco'};
function SnapshotFields({value,exclude=[]}){const fields=Object.entries(value||{}).filter(([key,item])=>!exclude.includes(key)&&item!=null&&item!==''&&typeof item!=='object');return fields.length?<dl className="snapshot-fields">{fields.map(([key,item])=><div key={key}><dt>{fieldLabels[key]||key.replaceAll('_',' ')}</dt><dd>{String(item)}</dd></div>)}</dl>:<p>Sin información adicional registrada.</p>}

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
    <div className="detail-head"><div><small>GESTIÓN DE PEDIDO</small><h2>Pedido {order.number}</h2><p>Actualizado {dateTime(order.updated_at)}</p></div><b className={`status ${STATUS[order.status]?.tone || 'neutral'}`}>{statusLabel(order.status)}</b><strong>{money(order.total, order.currency)}</strong></div>
    {order.status === 'CANCELLED' ? <p className="cancelled-note">Este pedido fue cancelado y su ciclo operativo terminó.</p> : <Progress status={order.status} />}
    <div className="detail-grid">
      <section><small>CLIENTE</small><h3>{customer.name || 'Cliente del pedido'}</h3><SnapshotFields value={customer} exclude={['name']}/></section>
      <section><small>DIRECCIÓN DE ENTREGA</small><h3>{delivery.address || delivery.address_line_1 || 'Dirección por confirmar'}</h3><SnapshotFields value={delivery} exclude={['address','address_line_1']}/><p>{order.delivery_method === 'scheduled' ? 'Entrega programada' : 'Entrega en tiempo real'}</p></section>
      <section><small>PAGO</small><h3>{paymentMethodLabel(payment.method)}</h3><p>{paymentStatusLabel(payment.status)}</p><SnapshotFields value={payment} exclude={['method','status']}/></section>
      <section><small>COMPRA</small><h3>{order.items.length} {order.items.length === 1 ? 'producto' : 'productos'}</h3><p>{order.items.reduce((sum,item)=>sum+Number(item.quantity),0)} unidades en total</p></section>
    </div>
    <section className="products-detail"><div className="section-heading"><h3>Productos</h3><span>{order.items.reduce((sum, item) => sum + Number(item.quantity), 0)} unidades</span></div>
      <div className="table-scroll"><table className="commerce-table detail-products"><thead><tr><th>Producto</th><th>Referencia</th><th>Precio unitario</th><th>Cantidad</th><th>Total</th></tr></thead><tbody>{order.items.map((item,index)=><tr key={item.id||item.position||index}><td><strong>{item.product_name||'Producto sin nombre'}</strong></td><td>{item.product_id?shortReference(item.product_id):'—'}</td><td>{money(item.unit_price,order.currency)}</td><td>{item.quantity}</td><td><strong>{money(item.subtotal,order.currency)}</strong></td></tr>)}</tbody></table></div>
      <dl className="totals"><div><dt>Subtotal</dt><dd>{money(order.subtotal, order.currency)}</dd></div><div><dt>Entrega</dt><dd>{money(order.delivery_fee, order.currency)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(order.total, order.currency)}</dd></div></dl>
    </section>
    <div className="actions">{writable ? (NEXT[order.status] || []).map(value => <button key={value} className={value === 'CANCELLED' ? 'danger' : 'primary'} onClick={() => transition(value)}>{value === 'CANCELLED' ? 'Cancelar pedido' : `Marcar: ${statusLabel(value)}`}</button>) : <span>Acceso de solo lectura</span>}{writable && !(NEXT[order.status] || []).length ? <span>Ciclo finalizado</span> : null}</div>
  </aside>;
}
