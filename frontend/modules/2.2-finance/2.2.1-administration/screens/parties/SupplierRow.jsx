import React from 'react';

const controls='a,button,input,select,textarea,label,summary,[role], [tabindex],audio[controls],video[controls],[contenteditable]:not([contenteditable="false"])';
const modified=event=>event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey;
const selectingText=()=>Boolean(window.getSelection()?.toString());

export default function SupplierRow({row,path,navigate}) {
  const openRow=event=>{
    if(event.defaultPrevented||modified(event)||selectingText())return;
    const control=event.target.closest?.(controls);
    if(control&&event.currentTarget.contains(control))return;
    navigate(path);
  };
  const openName=event=>{
    // Modified/middle clicks and the context menu keep the browser's native link behavior.
    if(event.defaultPrevented||modified(event))return;
    if(selectingText()){event.preventDefault();return;}
    event.preventDefault();
    navigate(path);
  };
  return <tr className="supplier-row" onClick={openRow}>
    <td className="finance-tech">{row.codigo}</td>
    <td><a className="supplier-name" href={'#'+path} onClick={openName}>{row.nombre}</a></td>
    <td className="finance-tech">{row.datos_generales?.numero_identificacion||'—'}</td>
    <td>{row.datos_generales?.email||'—'}</td>
    <td className="finance-tech">{row.datos_generales?.telefono||'—'}</td>
  </tr>;
}
