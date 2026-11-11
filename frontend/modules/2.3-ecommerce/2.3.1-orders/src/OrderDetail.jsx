import React, { useState } from 'react';
import { MODULES } from '../../../../shared/module-launcher/module-launcher.mjs';
import { detailHref, listHref } from '../../../../app-shell/src/detailRoutes.mjs';
import { FLOW, HANDOFF, NEXT, dateTime, money, paymentMethodLabel, paymentStatusLabel, statusLabel } from './orderView.js';
import FinanceIcon from '../../../2.2-finance/src/FinanceIcon.jsx';
import StatusBadge from '../../../../shared/status-badge/StatusBadge.jsx';
import './order-detail.css';
import {OrderInvoicePreview, OrderNotesPreview} from './OrderDemoActions.jsx';

const fieldLabels={name:'Nombre',email:'Correo',phone:'Teléfono',document:'Documento',company:'Empresa',recipient:'Recibe',address:'Dirección',address_line_1:'Dirección',address_line_2:'Complemento',city:'Ciudad',state:'Estado',postal_code:'Código postal',country:'País',reference:'Referencia',transaction_id:'Transacción',bank:'Banco'};
function SnapshotFields({value,exclude=[]}){const fields=Object.entries(value||{}).filter(([key,item])=>!exclude.includes(key)&&!/(^id$|_id$|uuid|customer.?id)/i.test(key)&&item!=null&&item!==''&&typeof item!=='object'&&!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(item)));return fields.length?<dl className="snapshot-fields">{fields.map(([key,item])=><div key={key}><dt>{fieldLabels[key]||key.replaceAll('_',' ')}</dt><dd>{String(item)}</dd></div>)}</dl>:null}

const paymentKeys=['method','status','currency','amount','amountUSD','amountVES','reference','exchangeRate','exchangeRateSource','exchangeRateEffectiveDate'];
const deliveryKeys=['address','address_line_1','zone','label','latitude','longitude'];
const decimal=value=>new Intl.NumberFormat('es-VE',{maximumFractionDigits:4}).format(Number(value));
function PaymentDetails({payment}){const currency=payment.currency||'USD',amount=payment.amount??payment[`amount${currency}`];return <><dl className="snapshot-fields">{amount!=null&&<div><dt>Monto pagado</dt><dd>{money(amount,currency)}</dd></div>}{payment.amountUSD!=null&&currency!=='USD'&&<div><dt>Equivalente en dólares</dt><dd>{money(payment.amountUSD,'USD')}</dd></div>}{payment.amountVES!=null&&currency!=='VES'&&<div><dt>Equivalente en bolívares</dt><dd>{money(payment.amountVES,'VES')}</dd></div>}{payment.reference&&<div><dt>Referencia</dt><dd>{payment.reference}</dd></div>}{payment.exchangeRate&&<div><dt>Tasa de cambio</dt><dd>{decimal(payment.exchangeRate)} VES/USD</dd></div>}{payment.exchangeRateSource&&<div><dt>Fuente de la tasa</dt><dd>{payment.exchangeRateSource==='bcv.today'?'Banco Central de Venezuela':payment.exchangeRateSource}</dd></div>}{payment.exchangeRateEffectiveDate&&<div><dt>Fecha de la tasa</dt><dd>{new Intl.DateTimeFormat('es-VE',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(`${payment.exchangeRateEffectiveDate}T00:00:00Z`))}</dd></div>}</dl><SnapshotFields value={payment} exclude={paymentKeys}/></>}
function DeliveryDetails({delivery}){return <><dl className="snapshot-fields">{delivery.label&&<div><dt>Tipo de dirección</dt><dd>{delivery.label}</dd></div>}{delivery.zone&&<div><dt>Zona</dt><dd>{delivery.zone}</dd></div>}{delivery.latitude!=null&&delivery.longitude!=null&&<div><dt>Ubicación</dt><dd>Ubicación registrada</dd></div>}</dl><SnapshotFields value={delivery} exclude={deliveryKeys}/></>}

function Progress({ status }) {
  const current = FLOW.indexOf(status);
  return <div className="od-stepper" aria-label={`Progreso: ${statusLabel(status)}`}>
    {FLOW.map((step, index) => <div className={index <= current ? 'complete' : ''} key={step}><span>{index < current ? <FinanceIcon name="check"/> : index + 1}</span><small>{statusLabel(step)}</small></div>)}
  </div>;
}

function OrderHistory({ history = [] }) {
  return <section className="od-card od-history"><div className="od-card-title"><div><h2>Historial del pedido</h2><p>Cambios registrados por el backend</p></div></div>
    {history.length ? <ol>{history.map(event => <li key={event.id}><span className="od-history-marker" aria-hidden="true"/><div><div className="od-history-heading"><StatusBadge status={event.status}>{statusLabel(event.status)}</StatusBadge><time dateTime={event.created_at}>{dateTime(event.created_at)}</time></div><p>{event.reason}</p>{event.detail&&<small>{event.detail}</small>}<small>Realizado por {event.actor_name||'Usuario autorizado'}</small></div></li>)}</ol>
      : <p className="od-history-empty">No hay cambios de estado registrados.</p>}
  </section>;
}

function SideCard({ title, children }) {
  return <section className="od-card od-side-card"><div className="od-card-title"><h2>{title}</h2></div><div className="od-side-content">{children}</div></section>;
}

function customerHistory(order, customerOrders) {
  const orders = customerOrders.some(item => item.id === order.id) ? customerOrders : [...customerOrders, order];
  const since = Math.min(...orders.map(item => new Date(item.created_at).getTime()).filter(Number.isFinite));
  return `${Number.isFinite(since) ? `Cliente desde ${new Date(since).getFullYear()} · ` : ''}${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'}`;
}

function CopyAddress({ address }) {
  const [copied, setCopied] = useState('');
  const copy = async () => {
    let done = false;
    try { await navigator.clipboard.writeText(address); done = true; }
    catch { const field = document.createElement('textarea'); field.value = address; field.setAttribute('readonly', ''); field.style.position = 'fixed'; field.style.opacity = '0'; document.body.append(field); field.select(); done = document.execCommand('copy'); field.remove(); }
    setCopied(done ? 'Dirección copiada' : 'No se pudo copiar. Selecciona la dirección y cópiala manualmente.');
    window.setTimeout(() => setCopied(''), 2500);
  };
  return <><button type="button" className="od-button secondary full" disabled={!address} onClick={copy}>{copied === 'Dirección copiada' ? <><FinanceIcon name="check"/>Dirección copiada</> : 'Copiar dirección'}</button><span className="od-copy-feedback" role="status">{copied === 'Dirección copiada' ? '' : copied}</span></>;
}

export default function OrderDetail({ order, writable, transition, addNote, close, nodeName, customerOrders = [], canOpenCustomer }) {
  const delivery = order.delivery_snapshot || {}, customer = order.customer_snapshot || {}, payment = order.payment_snapshot || {};
  const paymentReady=['VALIDATED','PENDING_COLLECTION'].includes(payment.status),next=(NEXT[order.status]||[]).filter(value=>value!=='CANCELLED'&&(value!=='CONFIRMED'||paymentReady)),handoff=HANDOFF[order.status],address=delivery.address||delivery.address_line_1||'';
  const handoffHref=handoff?.route==='routes'&&order.route_ref?detailHref('routes',order.route_ref):handoff?.detail?detailHref(handoff.route,order.id):handoff?listHref(handoff.route):'';
  const units=order.items.reduce((sum,item)=>sum+Number(item.quantity||0),0),initials=(customer.name||'C').split(/\s+/).slice(0,2).map(value=>value[0]).join('').toUpperCase();
  const financeUrl=MODULES.find(module=>module.id==='finance')?.href,customerUrl=canOpenCustomer&&financeUrl&&order.customer_id?`${financeUrl}#/modulos/finanzas/administracion/clientes/${encodeURIComponent(order.customer_id)}`:'';
  return <div className="figma-order-detail">
    <button type="button" className="od-back" onClick={close}><FinanceIcon name="arrow"/>Volver a pedidos</button>
    <div className="od-header"><div><div className="od-breadcrumb">E-commerce <span>/</span> Pedidos <span>/</span> {order.number}</div><h1>Pedido {order.number}</h1><p>Creado el {dateTime(order.created_at)} · Última actualización {dateTime(order.updated_at)}</p></div><div className="od-header-actions"><button type="button" className="od-button secondary" onClick={()=>window.print()}>Imprimir</button><OrderInvoicePreview key={order.id} order={order}/></div></div>
    <div className="od-layout">
      <div className="od-main">
        <section className="od-card"><div className="od-status-heading"><div><span>ESTADO ACTUAL</span><StatusBadge status={order.status}>{statusLabel(order.status)}</StatusBadge></div><strong>{money(order.total,order.currency)}</strong></div>
          {order.status==='CANCELLED'?<p className="cancelled-note od-cancelled">Este pedido fue cancelado y su ciclo operativo terminó.</p>:<Progress status={order.status}/>}
          {next[0]&&writable?<div className="od-status-action"><div><strong>Siguiente etapa: {statusLabel(next[0])}</strong><small>La actualización quedará registrada en el historial del pedido.</small></div><button type="button" className="od-button primary" onClick={()=>transition(next[0])}>Marcar como {statusLabel(next[0])}</button></div>:order.status==='PENDING'&&payment.status==='PENDING_VERIFICATION'?<div className="od-status-action"><div><strong>En espera de validación de Finanzas</strong><small>Operaciones continuará cuando Finanzas valide el pago electrónico.</small></div></div>:order.status==='PENDING'&&payment.status==='REJECTED'?<div className="od-status-action"><div><strong>Pago rechazado por Finanzas</strong><small>El pedido no puede confirmarse mientras el pago permanezca rechazado.</small></div></div>:handoff?<div className="od-status-action"><div><strong>{handoff.title}</strong><small>{handoff.note}</small></div><a className="od-button primary" href={handoffHref}>{handoff.label}</a></div>:null}
        </section>
        <section className="od-card od-products"><div className="od-card-title"><div><h2>Productos del pedido</h2><p>{units} {units===1?'unidad':'unidades'} en total</p></div></div>
          {order.items.map((item,index)=><div className="od-product-line" key={item.id||item.position||index}><span className="od-product-image"><FinanceIcon name="package"/></span><div><strong>{item.product_name||'Producto sin nombre'}</strong><small>SKU: {item.product_code||'Sin referencia'} · Cantidad: {item.quantity}</small></div><span>{money(item.unit_price,order.currency)}</span><strong>{money(item.subtotal,order.currency)}</strong></div>)}
          <div className="od-totals"><span>Subtotal <b>{money(order.subtotal,order.currency)}</b></span><span>Entrega <b>{money(order.delivery_fee,order.currency)}</b></span><span>Total <b>{money(order.total,order.currency)}</b></span></div>
        </section>
        <OrderHistory history={order.history}/>
        <OrderNotesPreview key={order.id} notes={order.notes||[]} writable={writable} addNote={addNote}/>
        {writable&&(NEXT[order.status]||[]).includes('CANCELLED')?<div className="od-cancel"><button type="button" className="od-button danger" onClick={()=>transition('CANCELLED')}>Cancelar pedido</button></div>:null}
      </div>
      <div className="od-side">
        <SideCard title="Cliente"><div className="od-customer"><span>{initials}</span><div><strong>{customer.name||'Cliente del pedido'}</strong><small>{customerHistory(order,customerOrders)}</small></div></div><dl className="snapshot-fields"><div><dt>Correo</dt><dd>{customer.email||'Sin registrar'}</dd></div><div><dt>Teléfono</dt><dd>{customer.phone||'Sin registrar'}</dd></div></dl><SnapshotFields value={customer} exclude={['name','email','phone']}/>{customerUrl?<a className="od-button secondary full" href={customerUrl}>Ver ficha del cliente</a>:null}</SideCard>
        <SideCard title="Entrega"><dl className="snapshot-fields"><div><dt>Dirección</dt><dd>{address||'Dirección por confirmar'}</dd></div><div><dt>Método</dt><dd>{order.delivery_method==='scheduled'?'Entrega programada':'Entrega en tiempo real'}</dd></div>{nodeName?<div><dt>Nodo asignado</dt><dd>{nodeName}</dd></div>:null}</dl><DeliveryDetails delivery={delivery}/><CopyAddress address={address}/></SideCard>
        <SideCard title="Pago"><dl className="snapshot-fields"><div><dt>Método</dt><dd>{paymentMethodLabel(payment.method,payment)}</dd></div><div><dt>Estado</dt><dd>{paymentStatusLabel(payment.status)}</dd></div></dl><PaymentDetails payment={payment}/></SideCard>
      </div>
    </div>
  </div>;
}
