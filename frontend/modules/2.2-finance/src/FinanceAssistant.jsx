import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import FinanceIcon from './FinanceIcon.jsx';
import isotipo from './assets/brands/uonify-isotipo.svg';
const AssistantContext=createContext(null);
const labels={'resumen-compras':'Resumen de compras','solicitudes-compra':'Compras','sugerencias-compras':'Sugerencias de compras','ordenes-compra':'Órdenes de compra','facturas-proveedores':'Facturas de proveedores',clientes:'Clientes',proveedores:'Proveedores',ventas:'Ventas'};
export function FinanceAssistantProvider({children,enabled=true,path=''}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState('');
 const trigger=useRef(null);
 const label=Object.entries(labels).find(([key])=>path.includes(key))?.[1]||'Finanzas';
 const close=()=>{setOpen(false);requestAnimationFrame(()=>trigger.current?.focus());};
 return <AssistantContext.Provider value={enabled?{open,setOpen,draft,setDraft,trigger,close,label}:null}>{children}</AssistantContext.Provider>;
}
export function FinanceAssistantToggle(){
 const a=useContext(AssistantContext);if(!a)return null;
 return <button ref={a.trigger} type="button" className="finance-assistant-toggle secondary" aria-label="Uony en Finanzas" title="Uony" aria-expanded={a.open} aria-controls="finance-assistant" onClick={()=>a.open?a.close():a.setOpen(true)}><img src={isotipo} alt="" aria-hidden="true"/></button>;
}
export function FinanceAssistantPanel(){
 const a=useContext(AssistantContext),panel=useRef(null);
 const [modal,setModal]=useState(()=>matchMedia('(max-width:1100px)').matches);
 useEffect(()=>{const m=matchMedia('(max-width:1100px)');const change=()=>setModal(m.matches);m.addEventListener('change',change);return()=>m.removeEventListener('change',change);},[]);
 const opened=a?.open;
 useEffect(()=>{
  if(!opened)return;
  panel.current?.querySelector('textarea')?.focus();
  const key=e=>{
   if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();a.close();}
   if(modal&&e.key==='Tab'){
    const items=[...panel.current.querySelectorAll('button:not(:disabled),textarea,a[href]')];const first=items[0],last=items.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  };
  const background=modal?[...panel.current.parentElement.children].filter(e=>e!==panel.current&&!e.classList.contains('finance-assistant-scrim')):[];if(modal){const header=document.querySelector('.finance-app .integrated-header');if(header)background.push(header);}const previous=background.map(e=>[e,e.inert]);background.forEach(e=>e.inert=true);
  document.addEventListener('keydown',key);const overflow=document.body.style.overflow;if(modal)document.body.style.overflow='hidden';
  return()=>{document.removeEventListener('keydown',key);previous.forEach(([e,inert])=>e.inert=inert);if(modal)document.body.style.overflow=overflow;};
 },[opened,modal]);
 if(!opened)return null;
 return <>{modal&&<div className="finance-assistant-scrim" onClick={a.close} aria-hidden="true"/>}<aside ref={panel} id="finance-assistant" className="finance-assistant-panel" role={modal?'dialog':'complementary'} aria-modal={modal?true:undefined} aria-labelledby="finance-assistant-title">
  <header className="finance-assistant-heading"><div><span className="finance-assistant-symbol"><img src={isotipo} alt="" aria-hidden="true"/></span><h2 id="finance-assistant-title">Uony<span>Tu contexto de trabajo</span></h2></div><button type="button" className="secondary" aria-label="Cerrar Uony" onClick={a.close}><FinanceIcon name="close"/></button></header>
  <div className="finance-assistant-body"><p className="finance-assistant-context">Estás viendo <strong>{a.label}</strong>.</p><p>Selecciona un registro para trabajar con un contexto específico.</p><div className="finance-assistant-empty"><img src={isotipo} alt="" aria-hidden="true"/><h3>Una ayuda, en tu espacio</h3><p>Aquí podrás consultar y trabajar sobre la pantalla que tienes abierta.</p><span>Uony aún no está conectado aquí</span></div></div>
  <form className="finance-assistant-composer" onSubmit={e=>e.preventDefault()}><label htmlFor="finance-ai-draft">Escribe a Uony</label><textarea id="finance-ai-draft" value={a.draft} onChange={e=>a.setDraft(e.target.value)} maxLength={2000} placeholder="Escribe tu consulta..." aria-describedby="finance-ai-status"/><div><small id="finance-ai-status">Vista de interfaz. Los mensajes no se envían.</small><button disabled type="submit" aria-label="Enviar mensaje (IA sin conectar)"><FinanceIcon name="send"/></button></div></form>
 </aside></>;
}
