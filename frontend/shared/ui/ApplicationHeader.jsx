import React from 'react';
import ModuleLauncher from '../module-launcher/ModuleLauncher.jsx';

export default function ApplicationHeader({
  workspace, currentApp, brand, brandHref, brandCaption, menuOpen, onToggleMenu, menuTrigger, children,
}) {
  return <header className="integrated-header">
    <button ref={menuTrigger} type="button" className="menu-toggle secondary" aria-controls={`${currentApp}-navigation`} aria-label="Abrir menú" aria-expanded={menuOpen} onClick={onToggleMenu}>☰</button>
    <a className="brand" href={brandHref}>{brand}{brandCaption ? <span>{brandCaption}</span> : null}</a>
    <div className="context-controls">
      {children}
      <ModuleLauncher currentApp={currentApp}/>
      <button className="secondary" disabled={workspace.authenticating} onClick={workspace.signedIn ? workspace.signOut : workspace.startLogin}>{workspace.signedIn ? 'Salir' : workspace.authenticating ? 'Redirigiendo…' : 'Acceder'}</button>
    </div>
  </header>;
}
