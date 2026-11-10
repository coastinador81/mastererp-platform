import React, {useState} from 'react';
import {money} from './orderView.js';

// Explicit UI previews only: no invoice/notes API exists in the current order contract.
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
export function OrderNotesPreview({writable}) {
  const [draft, setDraft] = useState(''), [notes, setNotes] = useState([]);
  return <section className="od-card"><div className="od-card-title"><div><h2>Notas internas</h2><p>Simulación local: estas notas no se guardan ni se comparten. Se descartan al salir.</p></div></div><div className="od-side-content">
    {notes.length > 0 && <ul>{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    {writable && <><label htmlFor="order-demo-note">Nota de prueba</label><textarea id="order-demo-note" maxLength={2000} value={draft} onChange={event => setDraft(event.target.value)} style={{width:'100%',minHeight:90}}/><button type="button" className="od-button secondary" disabled={!draft.trim()} onClick={() => {setNotes(current => [...current, draft.trim()]); setDraft('');}}>Añadir nota (local)</button></>}
  </div></section>;
}
