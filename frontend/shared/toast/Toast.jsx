import React from 'react';
import './toast.css';
import{readableMessage}from'./toastMessage.mjs';

const presentation={
  success:{title:'Listo',symbol:'↓'},
  error:{title:'No se pudo completar',symbol:'!'},
  info:{title:'Información',symbol:'i'},
};

export default function Toast({message,tone='error',onClose}){
  if(!message)return null;
  const view=presentation[tone]||presentation.info;
  return <div className={`shared-toast shared-toast-${tone}`} role={tone==='error'?'alert':'status'} aria-live={tone==='error'?'assertive':'polite'}>
    <span className="shared-toast-icon" aria-hidden="true">{view.symbol}</span>
    <span className="shared-toast-content"><strong>{view.title}</strong><span>{readableMessage(message)}</span></span>
    <button className="shared-toast-close" type="button" onClick={onClose} aria-label="Cerrar notificación">×</button>
  </div>;
}
