import React from 'react';
import { FLOW, NEXT, STATUS, dateTime, money, paymentMethodLabel, paymentStatusLabel, statusLabel } from './orderView.js';

const fieldLabels={name:'Nombre',email:'Correo',phone:'Teléfono',document:'Documento',company:'Empresa',recipient:'Recibe',address:'Dirección',address_line_1:'Dirección',address_line_2:'Complemento',city:'Ciudad',state:'Estado',postal_code:'Código postal',country:'País',reference:'Referencia',transaction_id:'Transacción',bank:'Banco'};
function SnapshotFields({value,exclude=[]}){const fields=Object.entries(value||{}).filter(([key,item])=>!exclude.includes(key)&&!/(^id$|_id$|uuid|customer.?id)/i.test(key)&&item!=null&&item!==''&&typeof item!=='object'&&!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(item)));return fields.length?<dl className="snapshot-fields">{fields.map(([key,item])=><div key={key}><dt>{fieldLabels[key]||key.replaceAll('_',' ')}</dt><dd>{String(item)}</dd></div>)}</dl>:<p>Sin información adicional registrada.</p>}

const paymentKeys=['method','status','currency','amount','amountUSD','amountVES','reference','exchangeRate','exchangeRateSource','exchangeRateEffectiveDate'];
const deliveryKeys=['address','address_line_1','zone','label','latitude','longitude'];
const decimal=value=>new Intl.NumberFormat('es-VE',{maximumFractionDigits:4}).format(Number(value));
function PaymentDetails({payment}){const currency=payment.currency||'USD',amount=payment.amount??payment[`amount${currency}`];return <><dl className="snapshot-fields">{amount!=null&&<div><dt>Monto pagado</dt><dd>{money(amount,currency)}</dd></div>}{payment.amountUSD!=null&&currency!=='USD'&&<div><dt>Equivalente en dólares</dt><dd>{money(payment.amountUSD,'USD')}</dd></div>}{payment.amountVES!=null&&currency!=='VES'&&<div><dt>Equivalente en bolívares</dt><dd>{money(payment.amountVES,'VES')}</dd></div>}{payment.reference&&<div><dt>Referencia</dt><dd>{payment.reference}</dd></div>}{payment.exchangeRate&&<div><dt>Tasa de cambio</dt><dd>{decimal(payment.exchangeRate)} VES/USD</dd></div>}{payment.exchangeRateSource&&<div><dt>Fuente de la tasa</dt><dd>{payment.exchangeRateSource==='bcv.today'?'Banco Central de Venezuela':payment.exchangeRateSource}</dd></div>}{payment.exchangeRateEffectiveDate&&<div><dt>Fecha de la tasa</dt><dd>{new Intl.DateTimeFormat('es-VE',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(`${payment.exchangeRateEffectiveDate}T00:00:00Z`))}</dd></div>}</dl><SnapshotFields value={payment} exclude={paymentKeys}/></>}
function DeliveryDetails({delivery}){return <><dl className="snapshot-fields">{delivery.label&&<div><dt>Tipo de dirección</dt><dd>{delivery.label}</dd></div>}{delivery.zone&&<div><dt>Zona</dt><dd>{delivery.zone}</dd></div>}{delivery.latitude!=null&&delivery.longitude!=null&&<div><dt>Ubicación</dt><dd>Ubicación registrada</dd></div>}</dl><SnapshotFields value={delivery} exclude={deliveryKeys}/></>}

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
      <section><small>DIRECCIÓN DE ENTREGA</small><h3>{delivery.address || delivery.address_line_1 || 'Dirección por confirmar'}</h3><DeliveryDetails delivery={delivery}/><p>{order.delivery_method === 'scheduled' ? 'Entrega programada' : 'Entrega en tiempo real'}</p></section>
      <section><small>PAGO</small><h3>{paymentMethodLabel(payment.method)}</h3><p>{paymentStatusLabel(payment.status)}</p><PaymentDetails payment={payment}/></section>
      <section><small>COMPRA</small><h3>{order.items.length} {order.items.length === 1 ? 'producto' : 'productos'}</h3><p>{order.items.reduce((sum,item)=>sum+Number(item.quantity),0)} unidades en total</p></section>
    </div>
    <section className="products-detail"><div className="section-heading"><h3>Productos</h3><span>{order.items.reduce((sum, item) => sum + Number(item.quantity), 0)} unidades</span></div>
      <div className="table-scroll"><table className="commerce-table detail-products"><thead><tr><th>Producto</th><th>Referencia</th><th>Precio unitario</th><th>Cantidad</th><th>Total</th></tr></thead><tbody>{order.items.map((item,index)=><tr key={item.id||item.position||index}><td><strong>{item.product_name||'Producto sin nombre'}</strong></td><td>{item.product_code||'—'}</td><td>{money(item.unit_price,order.currency)}</td><td>{item.quantity}</td><td><strong>{money(item.subtotal,order.currency)}</strong></td></tr>)}</tbody></table></div>
      <dl className="totals"><div><dt>Subtotal</dt><dd>{money(order.subtotal, order.currency)}</dd></div><div><dt>Entrega</dt><dd>{money(order.delivery_fee, order.currency)}</dd></div><div className="grand-total"><dt>Total</dt><dd>{money(order.total, order.currency)}</dd></div></dl>
    </section>
    <div className="actions">{writable ? (NEXT[order.status] || []).map(value => <button key={value} className={value === 'CANCELLED' ? 'danger' : 'primary'} onClick={() => transition(value)}>{value === 'CANCELLED' ? 'Cancelar pedido' : `Marcar: ${statusLabel(value)}`}</button>) : <span>Acceso de solo lectura</span>}{writable && !(NEXT[order.status] || []).length ? <span>Ciclo finalizado</span> : null}</div>
  </aside>;
}
