import React,{useEffect,useRef,useState}from'react';
import'./action-dialog.css';

export default function ActionDialog({open,title,description,confirmLabel='Confirmar',reasonLabel,reasonRequired=false,busy=false,onCancel,onConfirm}){
  const[reason,setReason]=useState(''),field=useRef(null);
  useEffect(()=>{if(open){setReason('');window.setTimeout(()=>field.current?.focus(),0);}},[open]);
  useEffect(()=>{if(!open)return;const key=event=>{if(event.key==='Escape'&&!busy)onCancel();};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[open,busy,onCancel]);
  if(!open)return null;
  const submit=event=>{event.preventDefault();if(reasonRequired&&reason.trim().length<3)return;onConfirm(reason.trim());};
  return <div className="action-dialog-scrim" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onCancel();}}><form className="action-dialog" role="dialog" aria-modal="true" aria-labelledby="action-dialog-title" onSubmit={submit}><h2 id="action-dialog-title">{title}</h2>{description?<p>{description}</p>:null}{reasonLabel?<label>{reasonLabel}<textarea ref={field} rows="4" maxLength="500" required={reasonRequired} value={reason} onChange={event=>setReason(event.target.value)}/></label>:<button ref={field} className="dialog-focus" type="button" aria-hidden="true"/>}<div><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancelar</button><button className="primary" disabled={busy||reasonRequired&&reason.trim().length<3}>{busy?'Guardando…':confirmLabel}</button></div></form></div>;
}
