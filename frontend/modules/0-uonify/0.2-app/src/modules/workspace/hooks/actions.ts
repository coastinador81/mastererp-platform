import { flushSync } from 'react-dom';
import { NARROW_CHAT_QUERY } from '../model/chatPanel';
import { DEFAULT_VIEW, isServiceId, servicePath, WORKSPACE_PATH, type ServiceId } from '../model/services';
import { useComposerStore } from './composerStore';
import { setUi, useUiStore, usable, workspaceRefs } from './uiStore';
import { activeThreadOf, useWorkspaceStore } from './workspaceStore';

/**
 * Acciones del espacio (app-shell.js): navegación entre hilos y servicios,
 * paneles y foco. Funciones sin React para que las usen por igual los
 * componentes, el motor de la conversación y los demás módulos.
 */
export function navigateTo(path: string, options?: { replace?: boolean }): void {
  workspaceRefs.navigate(path, options);
}

/**
 * Abre una página del espacio que no es un servicio (Configuración): cierra los
 * menús y lleva el foco al contenido, que la página puede llevar después a su título.
 */
export function openWorkspacePage(path: string): void {
  closeAccountMenu();
  closeServices();
  closeNavDrawer(false);
  navigateTo(path);
  workspaceRefs.workspace?.focus({ preventScroll: true });
}

/** Pide el foco para el texto del compositor (aunque se vuelva a montar en otro sitio). */
export function focusComposer(): void {
  useComposerStore.getState().requestFocus();
}

export function closeServices(returnFocus = false): void {
  setUi({ servicesOpen: false });
  if (returnFocus) workspaceRefs.servicesTrigger?.focus();
}

/** PROTO `closeComposerPanels`: cierra el menú de cuenta. */
export function closeAccountMenu(): void {
  setUi({ accountOpen: false });
}

// Navegación estilo Claude: los hilos se abren en un panel a toda altura.
export function openNavDrawer(trigger?: HTMLElement | null): void {
  closeAccountMenu();
  closeServices();
  workspaceRefs.navReturnFocus = trigger ?? null;
  flushSync(() => setUi({ navOpen: true }));
  document.querySelector<HTMLElement>('#nav-drawer .nav-drawer-new')?.focus();
}

export function closeNavDrawer(restoreFocus = true): void {
  if (!useUiStore.getState().navOpen) return;
  flushSync(() => setUi({ navOpen: false }));
  if (restoreFocus) workspaceRefs.navReturnFocus?.focus();
  workspaceRefs.navReturnFocus = null;
}

export function toggleNavDrawer(trigger?: HTMLElement | null): void {
  if (useUiStore.getState().navOpen) closeNavDrawer();
  else openNavDrawer(trigger);
}

/** Vuelve al lienzo de conversación sin cambiar de hilo ni borrar el borrador. */
export function returnToChat(): void {
  const store = useWorkspaceStore.getState();
  const thread = activeThreadOf(store);
  if (thread) store.updateThread(thread.id, { service: null, view: DEFAULT_VIEW });
  store.setConversationExpanded(Boolean(thread));
  store.setChatPanelCollapsed(false);
  closeAccountMenu();
  closeServices();
  closeNavDrawer(false);
  setUi({ chatSheetOpen: false });
  navigateTo(WORKSPACE_PATH);
  focusComposer();
}

/** «Nuevo hilo»: vuelve al lienzo en blanco. */
export function startNewThread(projectId: string | null = null): void {
  const store = useWorkspaceStore.getState();
  store.setActiveThread(null);
  useWorkspaceStore.setState({ activeProjectId: projectId });
  store.setConversationExpanded(false);
  closeServices();
  closeNavDrawer(false);
  navigateTo(WORKSPACE_PATH);
  focusComposer();
}

export function selectThread(id: string): void {
  const store = useWorkspaceStore.getState();
  const thread = store.threads.find(item => item.id === id);
  if (!thread) return;
  closeNavDrawer(false);
  const current = useUiStore.getState().route;
  store.setActiveThread(thread.id);
  useWorkspaceStore.setState({ activeProjectId: thread.projectId ?? null });
  store.setConversationExpanded(true);
  // Entrar en Producto desde otro sitio abre su catálogo (salvo «nuevo producto»);
  // dentro de Producto, un hilo de la misma vista deja la ficha como está.
  const service = isServiceId(thread.service) ? thread.service : null;
  const keepProducto = service === 'producto' && current.service === 'producto' && thread.view === current.view;
  if (!keepProducto) navigateTo(servicePath(service, thread.view));
  focusComposer();
}

export function selectService(service: ServiceId, view: string = DEFAULT_VIEW): void {
  if (!isServiceId(service)) return;
  const current = useUiStore.getState().route;
  const store = useWorkspaceStore.getState();
  const thread = activeThreadOf(store);
  if (thread) store.updateThread(thread.id, { service, view });
  closeServices();
  // Volver a Producto desde su propio menú conserva la ficha abierta.
  const keep = service === 'producto' && current.service === 'producto' && view === DEFAULT_VIEW;
  if (!keep) navigateTo(servicePath(service, view));
  if (workspaceRefs.workspace) workspaceRefs.workspace.scrollTop = 0;
}

export function isNarrowChat(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(NARROW_CHAT_QUERY).matches);
}

/** Mostrar u ocultar la conversación junto a un servicio (hoja en pantallas estrechas). */
export function setChatPanel(open: boolean, origin: HTMLElement | null = null): void {
  const ui = useUiStore.getState();
  if (!ui.route.service || ui.embeddedDocks > 0) return;
  flushSync(() => {
    if (isNarrowChat()) setUi({ chatSheetOpen: open });
    else useWorkspaceStore.getState().setChatPanelCollapsed(!open);
  });
  // La entrada del panel la anima el layout al cambiar de sitio la conversación.
  if (open) {
    const list = workspaceRefs.messages;
    if (list) list.scrollTop = list.scrollHeight;
    workspaceRefs.draft?.focus({ preventScroll: true });
    return;
  }
  const target = usable(origin) ? origin : usable(workspaceRefs.chatFab) ? workspaceRefs.chatFab : workspaceRefs.chatToggle;
  target?.focus({ preventScroll: true });
}

/** «Nueva conversación» junto al servicio: el servicio sigue abierto, como en VS Code. */
export function newConversation(): void {
  closeAccountMenu();
  useWorkspaceStore.getState().setActiveThread(null);
  focusComposer();
}
