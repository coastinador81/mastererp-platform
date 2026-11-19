import React from 'react';
import ModuleLauncher from '../module-launcher/ModuleLauncher.jsx';
import {ApplicationAssistantToggle} from './ApplicationAssistant.jsx';
import UonifyChatLink from './UonifyChatLink.jsx';
import ApplicationThemeToggle from './ApplicationThemeToggle.jsx';
import './design-tokens.css';
import './application-header.css';

export default function ApplicationHeader({
  workspace,
  currentApp,
  brand,
  brandHref,
  brandCaption,
  menuOpen,
  onToggleMenu,
  menuTrigger,
  showAssistant = true,
  children,
}) {
  const displayAssistant = showAssistant && currentApp !== 'uonify';
  return (
    <header className="integrated-header application-header">
      <button
        ref={menuTrigger}
        type="button"
        className="menu-toggle secondary"
        aria-controls={`${currentApp}-navigation`}
        aria-label="Abrir menú"
        aria-expanded={menuOpen}
        onClick={onToggleMenu}
      >
        ☰
      </button>
      <a className="brand" href={brandHref}>
        {brand}
        {brandCaption ? <span>{brandCaption}</span> : null}
      </a>
      <div className="context-controls">
        {children}
        {['finance','ecommerce'].includes(currentApp)&&<ApplicationThemeToggle/>}
        {displayAssistant && <ApplicationAssistantToggle />}
        {displayAssistant && <UonifyChatLink />}
        <ModuleLauncher currentApp={currentApp} />
        {workspace && (
          <button
            className="secondary"
            disabled={workspace.authenticating}
            onClick={workspace.signedIn ? workspace.signOut : workspace.startLogin}
          >
            {workspace.signedIn ? 'Salir' : workspace.authenticating ? 'Redirigiendo…' : 'Acceder'}
          </button>
        )}
      </div>
    </header>
  );
}
