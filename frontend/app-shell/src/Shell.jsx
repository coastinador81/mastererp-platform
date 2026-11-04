import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceProvider,useWorkspace} from './session.jsx';
import Finance from '../../modules/2.2-finance/src/Finance.jsx';
import FinanceNavigation from '../../modules/2.2-finance/src/FinanceNavigation.jsx';
import Conversation from '../../modules/0-uonify/components/Conversation.jsx';
import './shell.css';
function Shell({independent=false}) {
  const w=useWorkspace(),[path,setPath]=useState(window.location.hash.slice(1)|| (independent?'/modulos/finanzas':'/')),[menu,setMenu]=useState(false);
  useEffect(()=>{const change=()=>{setPath(window.location.hash.slice(1)||'/');setMenu(false);};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  const navigate=route=>{if(window.location.hash!=='#'+route)window.location.hash=route;};
  const finance=w.context?.modules.includes('erp.finance')&&w.context?.permissions.includes('administration.parties.read');
  const financeRoute=path.startsWith('/modulos/finanzas');
  return <div className="integrated-app"><a className="skip-link" href="#workspace-content" onClick={e=>{e.preventDefault();document.getElementById('workspace-content')?.focus();}}>Saltar al contenido</a>
    <header className="integrated-header"><button className="menu-toggle secondary" aria-label="Abrir menú" aria-expanded={menu} onClick={()=>setMenu(!menu)}>☰</button><a className="brand" href="#/">{independent?'Finanzas':'Uonify'}<span>MasterERP · Desarrollo</span></a>
      <div className="context-controls">{w.signedIn&&<><label>Espacio<select aria-label="Espacio" value={w.tenant} onChange={e=>w.selectTenant(e.target.value)}><option value="">Selecciona un espacio</option>{w.spaces.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Empresa<select aria-label="Empresa" value={w.company} disabled={!w.context||w.loading} onChange={e=>w.selectCompany(e.target.value)}><option value="">Selecciona una empresa</option>{w.context?.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></>}
        <button className="secondary" onClick={w.signedIn?w.signOut:w.startLogin}>{w.signedIn?'Salir':'Acceder'}</button></div>
    </header>
    <div className="integrated-layout"><aside className={'integrated-nav '+(menu?'is-open':'')} aria-label="Navegación principal">{independent?<FinanceNavigation allowed={Boolean(finance)} path={path}/>:<><p className="nav-caption">ESPACIO DE TRABAJO</p><a href="#/" aria-current={path==='/'?'page':undefined}>Inicio</a><a href="#/chat" aria-current={path==='/chat'?'page':undefined}>Chat operativo</a>
      <p className="nav-caption">MÓDULOS HABILITADOS</p>{finance&&<><a href="#/modulos/finanzas" aria-current={financeRoute?'page':undefined}>Finanzas</a><span className="nav-section">Administración</span><a className="subnav" href="#/modulos/finanzas/administracion/clientes">Clientes</a><a className="subnav" href="#/modulos/finanzas/administracion/proveedores">Proveedores</a></>}
      {!finance&&<p className="nav-empty">{w.signedIn?'No hay módulos autorizados disponibles.':'Accede para consultar tus módulos.'}</p>}</>}<div className="nav-footer">Identidad compartida<br/>Permisos verificados por MasterERP</div></aside>
      <main id="workspace-content" className="integrated-content" tabIndex={-1}>
        {independent&&<p className="notice">Acceso independiente de desarrollo y pruebas de Finanzas. Las pantallas usan la misma implementación que Uonify.</p>}
        {w.error&&<div className="notice error" role="alert">{w.error} {w.signedIn&&<button className="secondary" onClick={()=>w.refresh()}>Revalidar acceso</button>}</div>}
        {!w.signedIn?<section className="hero"><p className="eyebrow">UN ESPACIO, TUS OPERACIONES</p><h1>Tu trabajo,<br/><em>conectado.</em></h1><p>Accede a tu espacio para abrir los módulos de tu empresa o trabajar con el chat.</p><button onClick={w.startLogin}>Acceder a mi espacio</button><p className="muted">Cognito autentica. MasterERP valida cada operación.</p></section>:
         w.loading?<p role="status">Validando espacio y permisos…</p>:
         !w.tenant?<div className="notice" role="status">{w.spaces.length?'Selecciona un espacio para continuar.':'Todavía no tienes un espacio asignado.'}</div>:
         !w.context?<div className="notice">El contexto autorizado no está disponible.</div>:
         financeRoute?<Finance workspace={w} path={path} navigate={navigate}/>:
         path==='/chat'?<Conversation/>:
         path!=='/'?<section><h1>Página no disponible</h1><a href="#/">Volver al inicio</a></section>:
         <section><p className="eyebrow">TU ESPACIO DE TRABAJO</p><h1>Todo empieza aquí.</h1><p>Abre un módulo desde el menú. También puedes visitar el chat, sin que sea obligatorio conversar.</p><div className="cards">{finance&&<a className="panel module-card" href="#/modulos/finanzas"><span>2.2 · FINANZAS</span><h2>Finanzas</h2><p>Administración, Clientes y Proveedores.</p><strong>Abrir módulo →</strong></a>}<a className="panel module-card" href="#/chat"><span>UONIFY</span><h2>Chat operativo</h2><p>Espacio conversacional. Asistente aún sin conectar.</p></a></div>{!finance&&<p className="notice">No hay módulos funcionales autorizados para este espacio.</p>}</section>}
      </main></div></div>;
}
export function mountWorkspace(element,options={}) {if(options.independent&&!window.location.hash&&window.location.pathname!=='/auth/callback')window.history.replaceState(null,'','/#/modulos/finanzas');createRoot(element).render(<WorkspaceProvider><Shell {...options}/></WorkspaceProvider>);}
