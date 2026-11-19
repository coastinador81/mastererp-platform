import React, {useState} from 'react';
import {createInvoicePdf} from './orderPdf.js';

// Invoice remains an explicit preview. Notes use the authorized Orders API.
export function OrderInvoicePreview({order,companyProfile}) {
  const [message,setMessage]=useState(''),[working,setWorking]=useState(false);
  async function download(){
    setWorking(true);setMessage('');
    try{
      await createInvoicePdf({order,companyProfile});setMessage('Factura PDF descargada.');
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
