import { USE_MOCKS } from '@/shared/api/config';
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { closeAccountMenu, closeNavDrawer, setChatPanel, startNewThread, returnToChat } from '../hooks/actions';
import { setUi, useRegisterRef, useUiStore } from '../hooks/uiStore';
import { useWorkspaceRoute } from '../hooks/useWorkspaceRoute';
import { chatLayout, type ChatLayout } from '../model/chatPanel';
import { workspacePageOf } from '../model/pages';
import { SERVICES, serviceIcon } from '../model/services';
import { AccountMenu } from './AccountMenu';
import { HelpButton, NotificationsBell } from './moduleBridge';
import { PlatformModuleLauncher } from './PlatformModuleLauncher';
import { ChatPanelIcon, SettingsIcon } from './ShellIcons';
import '../styles/01-shell.css';
import '../styles/03-responsive-navigation.css';
import '../styles/04-module-layout.css';
import '../styles/05-composer-controls.css';
import '../styles/07-header-limit.css';

/**
 * Cabecera del espacio: logotipo de Uonify (lienzo en blanco), icono y nombre del
 * servicio (o de la página, como Configuración), centro para el servicio (canales de
 * Producto, vía <TopbarCenter>) y, de derecha a izquierda: cuenta, servicios, ayuda
 * (módulo help), avisos (módulo notifications) y botón de la conversación. En
 * móvil, el logotipo pasa a su isotipo para que todo quepa (ver 07-header-tools.css).
 */
export function Topbar({ layout = chatLayout({ service: null, centred: true, narrow: false, sheetOpen: false, collapsed: false }), inert, preparing = false, accountMenu }: { layout?: ChatLayout; inert: boolean; preparing?: boolean; accountMenu?: ReactNode }) {
  const { service, pathname } = useWorkspaceRoute();
  const page = service ? null : workspacePageOf(pathname);
  const centerCount = useUiStore(state => state.topbarCenterCount);
  const chatToggle = useRef<HTMLButtonElement>(null);
  useRegisterRef('chatToggle', chatToggle);
  useEffect(() => {
    if (!preparing) return;
    closeAccountMenu();
    return () => { closeAccountMenu(); };
  }, [preparing]);

  // El logotipo equivale a «Inicio» con sesión: lienzo en blanco sin proyecto.
  const onBrand = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    closeAccountMenu();
    closeNavDrawer(false);
    if (preparing) { document.querySelector<HTMLElement>('#activation-progress')?.focus(); return; }
    startNewThread();
  };
  const panelOpen = layout.sidePanel && layout.open;

  return (
    <header className={`topbar${preparing ? ' activation-topbar' : ''}`} inert={inert}>
      <div className="topbar-left">
        <a className="workspace-brand" id="workspace-brand" href="/espacio" aria-label={preparing ? 'Uonify: preparación de tu cuenta' : 'Uonify: empezar de nuevo'} title={preparing ? 'Preparación de tu cuenta' : 'Empezar de nuevo'} onClick={onBrand}>
          <img className="workspace-brand-full" src="/assets/brands/uonify-wordmark-3d.webp" width={110} height={35} alt="" />
          <img className="workspace-brand-compact" src="/assets/brands/uonify-isotipo-3d.webp" width={36} height={22} alt="" />
        </a>
        {!preparing && service ? (
          <span className="topbar-module" id="topbar-module">
            <img src={serviceIcon(service)} width={22} height={22} alt="" />
            <strong>{SERVICES[service].name}</strong>
          </span>
        ) : !preparing && page ? (
          <span className="topbar-module topbar-page" id="topbar-module">
            <SettingsIcon />
            <strong>{page.name}</strong>
          </span>
        ) : null}
      </div>
      <div
        className="topbar-center"
        id="topbar-center"
        hidden={preparing || centerCount === 0}
        ref={node => {
          if (useUiStore.getState().topbarCenterNode !== node) setUi({ topbarCenterNode: node });
        }}
      />
      <div className="topbar-right">
        {!preparing && (service || page) && <button type="button" className="workspace-return-chat" onClick={returnToChat} aria-label="Volver al chat" title="Volver al chat sin perder la conversación"><ChatPanelIcon /><span>Volver al chat</span></button>}
        <span className="active-service-label" id="active-service-label" />
        <button
          ref={chatToggle}
          className="chat-panel-toggle"
          id="chat-panel-toggle"
          type="button"
          aria-controls="conversation-dock"
          aria-expanded={panelOpen}
          aria-label={layout.toggleLabel}
          data-tooltip={layout.toggleLabel}
          data-tooltip-pos="below"
          hidden={preparing || layout.toggleHidden}
          onClick={event => setChatPanel(!layout.open, event.currentTarget)}
        >
          <ChatPanelIcon />
        </button>
        {!preparing && USE_MOCKS && <NotificationsBell />}
        <HelpButton />
        {!preparing && <PlatformModuleLauncher currentApp="uonify" />}
        {accountMenu ?? <AccountMenu />}
      </div>
    </header>
  );
}
