import React from 'react';
import './toast.css';
import{readableMessage}from'./toastMessage.mjs';

export default function Toast({message,tone='error',onClose}){
  if(!message)return null;
  return <div className={`shared-toast shared-toast-${tone}`} role={tone==='error'?'alert':'status'} aria-live={tone==='error'?'assertive':'polite'}>
    <span>{readableMessage(message)}</span>
    <button type="button" onClick={onClose} aria-label="Cerrar notificación">×</button>
  </div>;
}
