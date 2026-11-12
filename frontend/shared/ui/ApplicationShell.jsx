import React, {useEffect, useRef, useState} from 'react';
import ApplicationHeader from './ApplicationHeader.jsx';
import RelatedServicesRail from '../module-launcher/RelatedServicesRail.jsx';
import {ApplicationAssistantProvider, ApplicationAssistantPanel} from './ApplicationAssistant.jsx';

export default function ApplicationShell({
  workspace,
  currentApp,
  brand,
  brandHref,
  brandCaption,
  contextLabel,
  contextKey,
  navigation,
  children,
  className = '',
  skipToId = 'content',
  environmentLabel,
  error,
  headerActions,
  showAssistant = true,
}) {
  const [menu, setMenu] = useState(false);
  const menuTrigger = useRef(null);

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && document.querySelector('.integrated-nav:is(.is-open,:focus-within)')) {
        setMenu(false);
        menuTrigger.current?.focus();
      }
    };
    const onHash = () => setMenu(false);
    const media = matchMedia('(max-width:800px)');
    const reset = () => setMenu(false);

    document.addEventListener('keydown', key);
    window.addEventListener('hashchange', onHash);
    media.addEventListener('change', reset);

    return () => {
      document.removeEventListener('keydown', key);
      window.removeEventListener('hashchange', onHash);
      media.removeEventListener('change', reset);
    };
  }, []);

  return (
    <ApplicationAssistantProvider
      applicationName={brand}
      contextLabel={contextLabel}
      contextKey={contextKey}
      enabled={showAssistant}
    >
      <div className={`integrated-app ecommerce-app ${className}`.trim()}>
        <a className="skip-link" href={`#${skipToId}`}>Saltar al contenido</a>
        <ApplicationHeader
          workspace={workspace}
          currentApp={currentApp}
          brand={brand}
          brandHref={brandHref}
          brandCaption={brandCaption}
          menuOpen={menu}
          onToggleMenu={() => setMenu(!menu)}
          menuTrigger={menuTrigger}
          showAssistant={showAssistant}
        >
          {headerActions}
        </ApplicationHeader>
        <div className="integrated-layout">
          <div className="finance-service-rail">
            <RelatedServicesRail currentApp={currentApp} />
          </div>
          <aside
            id={`${currentApp}-navigation`}
            aria-label={`Navegación de ${brand}`}
            className={`integrated-nav ${menu ? 'is-open' : ''}`}
          >
            {navigation}
          </aside>
          {menu && (
            <button
              type="button"
              className="finance-nav-scrim"
              aria-label={`Cerrar menú de ${brand}`}
              onClick={() => {
                setMenu(false);
                menuTrigger.current?.focus();
              }}
            />
          )}
          <main id={skipToId} className="integrated-content" tabIndex={-1}>
            {environmentLabel && <p className="environment">{environmentLabel}</p>}
            {error && <div className="notice error" role="alert">{error}</div>}
            {children}
          </main>
          {showAssistant && <ApplicationAssistantPanel />}
        </div>
      </div>
    </ApplicationAssistantProvider>
  );
}
