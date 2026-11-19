import React, {useState} from 'react';
import {dateTime, money, paymentMethodLabel} from './orderView.js';
import {createOrderPdf} from './orderPdf.js';

// Invoice remains an explicit preview. Notes use the authorized Orders API.
export function OrderInvoicePreview({order,companyProfile}) {
  const [message,setMessage]=useState(''),[working,setWorking]=useState(false);
  async function download(){
    setWorking(true);setMessage('');
    try{
      const customer=order.customer_snapshot||{},payment=order.payment_snapshot||{};
      const {line,heading,total,note,finish}=await createOrderPdf({companyProfile,title:'Factura del pedido',kicker:'E-COMMERCE · DOCUMENTO DEL PEDIDO',metadata:{subject:`Detalle del pedido ${order.number}`}});
      line('Pedido',order.number);line('Fecha',dateTime(order.created_at));line('Cliente',customer.name||'No registrado');line('Documento',customer.document||'No registrado');
      heading('Productos');for(const item of order.items||[])line(`${item.quantity} × ${item.product_name||'Producto'}`,`${money(item.unit_price,order.currency)} · ${money(item.subtotal,order.currency)}`);
      heading('Totales');line('Subtotal',money(order.subtotal,order.currency));line('Entrega',money(order.delivery_fee,order.currency));total(`TOTAL  ${money(order.total,order.currency)}`);
      heading('Pago');line('Método',paymentMethodLabel(payment.method,payment));line('Estado',payment.status||'No registrado');if(payment.reference)line('Referencia',payment.reference);
      note('Documento generado desde los datos registrados del pedido. La condición fiscal depende de la factura o nota emitida y vinculada por Finanzas.');
      finish(`factura-${order.number}`);setMessage('Factura PDF descargada.');
    }catch{setMessage('No se pudo generar el PDF. Inténtalo nuevamente.');}finally{setWorking(false);}
  }
  return <div><button type="button" className="od-button secondary" disabled={working} onClick={download}>{working?'Generando PDF…':'Descargar factura'}</button>{message&&<small role="status">{message}</small>}</div>;
}
export function OrderNotesPreview({notes,writable,addNote}) {
  const [draft,setDraft]=useState(''),[saving,setSaving]=useState(false);
  async function submit(){setSaving(true);if(await addNote(draft.trim()))setDraft('');setSaving(false);}
  return <section className="od-card"><div className="od-card-title"><div><h2>Notas internas</h2><p>Información privada para el equipo operativo.</p></div></div><div className="od-side-content od-notes">
    {notes.length > 0 ? <ul>{notes.map(note => <li key={note.id}><p>{note.note}</p><small>{note.actor_name||'Usuario autorizado'} · {new Intl.DateTimeFormat('es-VE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(note.created_at))}</small></li>)}</ul> : <p className="od-notes-empty">No hay notas internas.</p>}
    {writable && <><label htmlFor="order-note">Nueva nota</label><textarea id="order-note" maxLength={2000} value={draft} disabled={saving} onChange={event=>setDraft(event.target.value)}/><button type="button" className="od-button secondary" disabled={saving||!draft.trim()} onClick={submit}>{saving?'Guardando…':'Añadir nota'}</button></>}
  </div></section>;
}
