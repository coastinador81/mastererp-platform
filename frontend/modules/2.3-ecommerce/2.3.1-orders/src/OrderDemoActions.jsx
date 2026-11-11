import React, {useState} from 'react';
import {money} from './orderView.js';

// Invoice remains an explicit preview. Notes use the authorized Orders API.
export function OrderInvoicePreview({order}) {
  const [message, setMessage] = useState('');
  function download() {
    const text = ['VISTA PREVIA — NO ES UNA FACTURA FISCAL', 'Documento de demostración generado localmente. No acredita pago.', `Pedido: ${order.number}`, '', ...order.items.map(item => `${item.product_name || 'Producto'} · ${item.quantity} · ${money(item.subtotal, order.currency)}`), '', `Subtotal: ${money(order.subtotal, order.currency)}`, `Entrega: ${money(order.delivery_fee, order.currency)}`, `Total: ${money(order.total, order.currency)}`].join('\n');
    const url = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `pedido-${String(order.number).replace(/[^a-zA-Z0-9_-]/g, '')}-demo.txt`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('Vista previa descargada. La factura fiscal aún no está conectada.');
  }
  return <div><button type="button" className="od-button secondary" onClick={download}>Descargar factura (demo)</button>{message && <small role="status">{message}</small>}</div>;
}
export function OrderNotesPreview({notes,writable,addNote}) {
  const [draft,setDraft]=useState(''),[saving,setSaving]=useState(false);
  async function submit(){setSaving(true);if(await addNote(draft.trim()))setDraft('');setSaving(false);}
  return <section className="od-card"><div className="od-card-title"><div><h2>Notas internas</h2><p>Información privada para el equipo operativo.</p></div></div><div className="od-side-content od-notes">
    {notes.length > 0 ? <ul>{notes.map(note => <li key={note.id}><p>{note.note}</p><small>{note.actor_name||'Usuario autorizado'} · {new Intl.DateTimeFormat('es-VE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(note.created_at))}</small></li>)}</ul> : <p className="od-notes-empty">No hay notas internas.</p>}
    {writable && <><label htmlFor="order-note">Nueva nota</label><textarea id="order-note" maxLength={2000} value={draft} disabled={saving} onChange={event=>setDraft(event.target.value)}/><button type="button" className="od-button secondary" disabled={saving||!draft.trim()} onClick={submit}>{saving?'Guardando…':'Añadir nota'}</button></>}
  </div></section>;
}
