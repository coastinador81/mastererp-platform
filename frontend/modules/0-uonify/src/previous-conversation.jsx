import React, {useState,useRef,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import IdentityAccess from '../components/IdentityAccess';
import {ThreadsIcon,PlusIcon,CloseIcon,SendIcon,MicIcon,VoiceIcon} from '../components/ShellIcons';
import './previous-styles/tokens.css';
import './previous-styles/01-shell.css';
import './previous-styles/02-conversation.css';
import './previous-styles/03-responsive-navigation.css';
import './previous-styles/preview.css';
function App(){
 const [open,setOpen]=useState(false);const [draft,setDraft]=useState('');const toggle=useRef(null);const close=useRef(null);
 useEffect(()=>{if(open)close.current?.focus();},[open]);
 const dismiss=()=>{setOpen(false);toggle.current?.focus();};
 const key=e=>{if(e.key==='Escape')dismiss();if(e.key==='Tab'){const els=e.currentTarget.querySelectorAll('button:not([disabled])');if(els.length===1){e.preventDefault();els[0].focus();}}};
 return <div className="app-shell"><div className="workspace-column"><header className="preview-brand">Uonify<IdentityAccess/></header><main className="workspace is-home"><div className="welcome"><h1>Hazlo <em>posible.</em></h1><form className="composer" onSubmit={e=>e.preventDefault()} aria-describedby="availability"><label className="sr-only" htmlFor="composer-text">Escribe a Uony</label><textarea id="composer-text" placeholder="¿Qué quieres hacer posible hoy?" value={draft} onChange={e=>setDraft(e.target.value)} rows={2}/><div className="composer-bottom"><button type="button" disabled aria-label="Adjuntar archivos"><PlusIcon/></button><button ref={toggle} type="button" aria-label="Hilos y proyectos" aria-expanded={open} onClick={()=>setOpen(true)}><ThreadsIcon/></button><div className="composer-bottom-actions"><button type="button" disabled aria-label="Seleccionar modelo">Modelo no conectado</button><button type="button" disabled aria-label="Dictar"><MicIcon/></button><button type="button" disabled aria-label="Conversación por voz"><VoiceIcon/></button><button className="composer-send" type="submit" disabled aria-label="Enviar mensaje"><SendIcon/></button></div></div></form><p id="availability" className="preview-note">Disponible al conectar el asistente.</p></div></main></div>{open&&<><button className="preview-scrim" aria-label="Cerrar panel lateral" onClick={dismiss}/><aside className="nav-drawer preview-drawer" role="dialog" aria-modal="true" aria-labelledby="threads-title" onKeyDown={key}><div className="nav-drawer-head"><h2 id="threads-title">Hilos</h2><button ref={close} type="button" aria-label="Cerrar hilos" onClick={dismiss}><CloseIcon/></button></div><button className="nav-drawer-new" disabled><PlusIcon/>Nuevo hilo</button><section><h3>Proyectos</h3><button disabled>Nuevo proyecto</button><p>No hay proyectos.</p></section><section><h3>Recientes</h3><p>No hay conversaciones.</p></section></aside></>}</div>;
}
createRoot(document.getElementById('root')).render(<App/>);
