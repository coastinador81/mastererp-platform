import { USE_MOCKS } from '@/shared/api/config';
import { useLiveHistory } from '../hooks/liveConversation';
import { useDurableRecovery } from '../hooks/useDurableRecovery';
import { LiveServiceView } from './LiveServiceView';
import { LiveServices } from './LiveServices';
import { stopVoice } from '../hooks/voiceSession';
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useMediaQuery } from '@/shared/hooks';
import { setChatPanel, toggleNavDrawer } from '../hooks/actions';
import { syncComposerFromStorage } from '../hooks/composerStore';
import { setUi, useRegisterRef, useUiStore, workspaceRefs } from '../hooks/uiStore';
import { useWorkspaceRoute } from '../hooks/useWorkspaceRoute';
import {
  useChatSheetReset,
  useEscapeOrder,
  useNavExpandedSync,
  useScreenMotion,
  useWindowResizeTick,
  usePendingPrompt,
  type DockPlace,
} from '../hooks/useShellEffects';
import { useLimitWatcher } from '../hooks/useLimitWatcher';
import { activeThreadOf, useWorkspaceStore } from '../hooks/workspaceStore';
import { chatLayout, clampChatWidth, NARROW_CHAT_QUERY } from '../model/chatPanel';
import { entryRedirect, isEntryLoad, markEntryHandled, serviceLink } from '../model/entry';
import { applyStoredPreferences } from '../model/motion';
import { workspacePageOf } from '../model/pages';
import { ConversationPanel } from './ConversationPanel';
import { ChatGptLimitDialog } from './limit/ChatGptLimitDialog';
import { NavDrawer } from './navigation/NavDrawer';
import { Topbar } from './Topbar';
import '../styles/index.css';

/**
 * Marco del espacio de trabajo (plantilla #view-espacio y app-shell.js): cabecera,
 * contenido del servicio (<Outlet/>), conversación, hoja y botón flotante en
 * móvil, panel de hilos, aviso del límite de ChatGPT y los diálogos de acceso.
 * Las páginas que no son servicios (Configuración) ocupan todo el ancho bajo la
 * cabecera, sin conversación.
 */

/** Servicios con mesa propia también en vivo: su módulo pinta la vista en el <Outlet/>. */
const MODULE_WORKBENCHES: readonly string[] = ['producto', 'erp'];
function WorkspaceShell() {
  useLiveHistory();
  useDurableRecovery();
  useLayoutEffect(() => () => stopVoice(''), []);
  const navigate = useNavigate();
  const route = useWorkspaceRoute();
  const narrow = useMediaQuery(NARROW_CHAT_QUERY);
  const navOpen = useUiStore(state => state.navOpen);
  const sheetOpen = useUiStore(state => state.chatSheetOpen);
  const embedded = useUiStore(state => state.embeddedDocks > 0);
  const liveText = useUiStore(state => state.liveText);
  const dragWidth = useUiStore(state => state.chatDragWidth);
  const activeThread = useWorkspaceStore(activeThreadOf);
  const collapsed = useWorkspaceStore(state => state.chatPanelCollapsed);
  const savedWidth = useWorkspaceStore(state => state.chatPanelWidth);
  const lastReply = activeThread?.messages.filter(entry => entry.role === 'assistant').at(-1)?.text;
  const column = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const chatFab = useRef<HTMLButtonElement>(null);
  useRegisterRef('column', column);
  useRegisterRef('workspace', workspace);
  useRegisterRef('chatFab', chatFab);

  // El motor y las acciones (fuera de React) navegan y leen el servicio actual por aquí.
  useLayoutEffect(() => {
    workspaceRefs.navigate = (to, options) => void navigate(to, options);
  }, [navigate]);
  useLayoutEffect(() => {
    if (useUiStore.getState().route.pathname !== route.pathname) setUi({ route });
  }, [route]);
  useLayoutEffect(() => {
    applyStoredPreferences();
    // Lo elegido en el compositor de la portada sigue al entrar (mismas claves de sesión).
    syncComposerFromStorage();
    document.title = 'Uonify — Hazlo posible';
    document.querySelector('meta[name="description"]')?.setAttribute('content', 'Trabaja con tus proyectos y los servicios de Uonify en un mismo espacio.');
  }, []);

  const page = route.service ? null : workspacePageOf(route.pathname);
  const mode = route.service ? 'module' : page ? 'page' : activeThread ? 'chat' : 'home';
  const layout = chatLayout({ service: route.service, centred: embedded, narrow, sheetOpen, collapsed });
  const place: DockPlace = mode === 'home' || mode === 'page' ? 'hidden' : mode === 'chat' || layout.centred ? 'centre' : layout.open ? 'side' : 'hidden';
  const width = dragWidth ?? savedWidth;
  const columnWidth = workspaceRefs.column?.clientWidth ?? 0;
  const chatWidth = width && columnWidth ? clampChatWidth(width, columnWidth) : width;
  const backgroundInert = navOpen || layout.backgroundInert;

  useScreenMotion(route, activeThread?.id ?? null, place, embedded);
  useEscapeOrder();
  usePendingPrompt();
  useWindowResizeTick(Boolean(route.service && width));
  useChatSheetReset(route.service, narrow);
  useNavExpandedSync(navOpen);
  useLimitWatcher(mode !== 'page');

  // Los botones de otros servicios con data-open-nav (raíl de Producto) abren el panel de hilos.
  const onWorkspaceClick = (event: MouseEvent<HTMLElement>) => {
    const opener = (event.target as Element).closest<HTMLElement>('[data-open-nav]');
    if (opener) toggleNavDrawer(opener);
  };

  // Una página usa la cabecera en barra de los servicios, sin panel de conversación.
  const pageClasses = mode === 'page' ? ['is-module', 'is-chat-hidden', 'is-page'] : [];
  const columnClass = ['workspace-column', mode === 'chat' ? 'is-chat' : '', ...pageClasses, ...Object.entries(layout.columnClasses).filter(([, on]) => on).map(([name]) => name)].filter(Boolean).join(' ');
  // Producto y ERP · Finanzas pintan su mesa a todo el ancho (lista lateral y centro).
  const workbench = route.service === 'producto' || route.service === 'erp';
  const workspaceClass = ['workspace', mode === 'home' ? 'is-home' : '', mode === 'page' ? 'is-page' : '', workbench ? 'is-product' : ''].filter(Boolean).join(' ');

  return (
    <>
      <a className="skip-link" href="#workspace" inert={backgroundInert}>
        Saltar al espacio de trabajo
      </a>
      <div className="app-shell" id="app-shell">
        <div
          ref={column}
          className={columnClass}
          style={chatWidth ? ({ '--chat-width': `${chatWidth}px` } as CSSProperties) : undefined}
        >
          <Topbar layout={layout} inert={backgroundInert} />
          <main
            ref={workspace}
            className={workspaceClass}
            id="workspace"
            aria-label="Espacio de trabajo"
            tabIndex={-1}
            inert={backgroundInert}
            onClick={onWorkspaceClick}
          >
            {!USE_MOCKS && route.service && !MODULE_WORKBENCHES.includes(route.service) ? <LiveServiceView service={route.service} /> : !USE_MOCKS && !route.service && route.pathname !== '/espacio' ? <LiveServices /> : <Outlet />}
          </main>
          {layout.centred ? null : <ConversationPanel hidden={place === 'hidden'} inert={navOpen} sidePanel={layout.sidePanel} withComposer={mode === 'chat' || mode === 'module'} />}
          <p className="sr-only" id="conversation-live" role="status" aria-live="polite">
            {liveText}
          </p>
          <div className="chat-panel-scrim" id="chat-panel-scrim" hidden={layout.scrimHidden} onClick={() => setChatPanel(false)} />
          <button
            ref={chatFab}
            className="chat-panel-fab"
            id="chat-panel-fab"
            type="button"
            aria-controls="conversation-dock"
            aria-expanded="false"
            hidden={layout.fabHidden}
            inert={navOpen}
            onClick={() => setChatPanel(true)}
          >
            <span className="assistant-symbol" aria-hidden="true">✳</span>
            <span className="chat-panel-fab-text" id="chat-panel-fab-text">{lastReply || 'Conversación'}</span>
          </button>
          <NavDrawer />
        </div>
      </div>
      <ChatGptLimitDialog />
    </>
  );
}

/**
 * Reglas de recarga: recargar (o entrar directamente en) el espacio lleva al
 * lienzo limpio, salvo `?service=`, que abre ese servicio (ver model/entry.ts).
 */
export function WorkspaceLayout() {
  const location = useLocation();
  const [redirect] = useState(() => (isEntryLoad(location.pathname, location.search) ? entryRedirect(location.pathname, location.search) : null));
  useLayoutEffect(() => markEntryHandled(), []);
  if (redirect && isEntryLoad(location.pathname, location.search)) return <Navigate to={redirect} replace />;
  const link = serviceLink(location.search);
  if (link) return <Navigate to={link} replace />;
  return <WorkspaceShell />;
}
