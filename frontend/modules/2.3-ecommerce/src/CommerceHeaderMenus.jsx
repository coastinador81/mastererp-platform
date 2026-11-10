import React, {useEffect, useRef, useState} from 'react';
import FinanceIcon from '../../2.2-finance/src/FinanceIcon.jsx';
import {MODULES} from '../../../shared/module-launcher/module-launcher.mjs';
import './commerce-header.css';

export default function CommerceHeaderMenus({workspace}) {
  const [open, setOpen] = useState(''), root = useRef(null), trigger = useRef(null);
  useEffect(() => {setOpen('');}, [workspace.tenant, workspace.company, workspace.signedIn]);
  useEffect(() => {
    const close = event => {if (!root.current?.contains(event.target)) setOpen('');};
    const escape = event => {if (event.key === 'Escape' && open) {setOpen(''); trigger.current?.focus();}};
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => {document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape);};
  }, [open]);
  if (!workspace.signedIn) return null;
  const toggle = (event, value) => {trigger.current = event.currentTarget; setOpen(current => current === value ? '' : value);};
  const accountUrl = MODULES.find(module => module.id === 'uonify')?.href;
  return <div className="commerce-header-menus" ref={root}>
    <button type="button" className="secondary commerce-icon-button commerce-notifications" aria-label="Notificaciones" aria-expanded={open === 'notifications'} aria-controls="commerce-header-panel" onClick={e => toggle(e, 'notifications')}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10 20h4"/></svg></button>
    <button type="button" className="secondary commerce-icon-button" aria-label="Mi cuenta" aria-expanded={open === 'account'} aria-controls="commerce-header-panel" onClick={e => toggle(e, 'account')}><FinanceIcon name="supplier"/></button>
    {open && <section id="commerce-header-panel" className="commerce-header-panel" aria-label={open === 'account' ? 'Mi cuenta' : 'Notificaciones'}><h2>{open === 'account' ? 'Mi cuenta' : 'Notificaciones'}</h2>
      {open === 'notifications' ? <p>Vista previa del centro de notificaciones. La recepción de avisos todavía no está conectada.</p> : <><dl><dt>Espacio</dt><dd>{workspace.spaces?.find(space => space.id === workspace.tenant)?.name || 'Sin selección'}</dd><dt>Empresa</dt><dd>{workspace.context?.companies?.find(company => company.id === workspace.company)?.name || 'Sin selección'}</dd></dl>{accountUrl && <a href={accountUrl}>Abrir mi espacio en Uonify</a>}<p><button type="button" className="secondary" onClick={e => toggle(e, 'notifications')}>Notificaciones</button></p><button type="button" className="secondary" onClick={workspace.signOut}>Cerrar sesión</button></>}
    </section>}
  </div>;
}
