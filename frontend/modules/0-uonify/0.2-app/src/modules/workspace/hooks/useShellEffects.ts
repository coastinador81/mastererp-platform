import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { USE_MOCKS } from '@/shared/api/config';
import { useInitialIntent } from './initialIntent';
import { useOnboardingEntry } from './useOnboardingEntry';
import { playEnter } from '../model/motion';
import { screenKey, type WorkspaceRoute } from '../model/services';
import { closeAccountMenu, closeNavDrawer, closeServices, setChatPanel } from './actions';
import { composerPopupOpen } from './composerStore';
import { takePendingPrompt, useSession } from '../components/authBridge';
import { sendPrompt } from './conversation';
import { setUi, useUiStore, workspaceRefs } from './uiStore';

/**
 * Comportamientos globales del marco del espacio (app-shell.js), separados del
 * componente para que el layout solo pinte.
 */

export type DockPlace = 'hidden' | 'side' | 'centre';

/**
 * Cada cambio de pantalla entra con el mismo efecto sutil; la conversación entra
 * cuando aparece o cambia de sitio (centro ↔ lado), y otro hilo junto a un
 * servicio entra suavemente (`renderWorkspace` del PROTO).
 */
export function useScreenMotion(route: WorkspaceRoute, activeThreadId: string | null, place: DockPlace, embedded: boolean): void {
  const last = useRef<{ screen: string; thread: string | null; place: DockPlace } | null>(null);
  const screen = screenKey(route, activeThreadId);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = { screen, thread: activeThreadId, place };
    if (!before) return;
    // La primera entrada ya anima el marco entero sin desenfoque ni efectos apilados.
    if (workspaceRefs.column?.classList.contains('uon-enter-soft')) return;
    const workspace = workspaceRefs.workspace;
    if (before.screen !== screen) playEnter(workspace);
    // La conversación centrada dentro de un servicio ya entra con su pantalla.
    const nested = embedded && (before.screen !== screen || Boolean(workspace?.querySelector('.product-center.uon-enter')));
    if (nested) return;
    if (place !== 'hidden' && (place !== before.place || (before.screen !== screen && place === 'centre'))) playEnter(workspaceRefs.dock, place === 'side' ? 'uon-enter-side' : 'uon-enter');
    else if (before.thread !== activeThreadId && place !== 'hidden') playEnter(workspaceRefs.conversationContent, 'uon-enter-soft');
  }, [screen, activeThreadId, place, embedded]);
}

/**
 * Un Escape cierra una sola cosa: el panel de hilos, el menú de servicios, un
 * menú abierto (el de cuenta o los del compositor, que se cierran solos) y
 * después la hoja de conversación en móvil. Los servicios que cierran algo suyo
 * con Escape (menú de canal, catálogo) llaman a `event.preventDefault()`.
 */
export function useEscapeOrder(): void {
  useEffect(() => {
    let popupWasOpen = false;
    const capture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') popupWasOpen = composerPopupOpen();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if ((event.target as Element | null)?.closest?.('dialog[open]')) return;
      const ui = useUiStore.getState();
      if (ui.navOpen) {
        closeNavDrawer();
        return;
      }
      if (ui.servicesOpen) {
        closeServices(true);
        return;
      }
      if (event.defaultPrevented) return;
      const hadAccountMenu = ui.accountOpen;
      closeAccountMenu();
      if (hadAccountMenu) workspaceRefs.accountButton?.focus();
      if (hadAccountMenu || popupWasOpen) return;
      if (workspaceRefs.column?.classList.contains('is-chat-sheet')) setChatPanel(false);
    };
    window.addEventListener('keydown', capture, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', capture, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}

/**
 * Con la sesión lista (PROTO: `UonifyAuth.ensureWorkspaceReady`), la petición
 * escrita antes de entrar se envía enseguida: la bienvenida fue su antesala. Las
 * guardas (sin sesión → portada; alta a medias → alta) las aplica <AuthDialogs/>.
 */
export function usePendingPrompt(): void {
  const { status, user } = useSession();
  const account = status === 'ready' ? user?.email ?? null : null;
  const onboardingEntry = useOnboardingEntry(account);
  useInitialIntent(account, onboardingEntry);
  const done = useRef(false);
  useEffect(() => {
    if (!USE_MOCKS || done.current || status !== 'ready') return;
    done.current = true;
    const waiting = takePendingPrompt();
    if (waiting) sendPrompt(waiting, { immediate: true });
  }, [status]);
}

/** Vuelve a pintar al cambiar el tamaño de la ventana (límites del ancho del panel). */
export function useWindowResizeTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const onResize = () => setTick(tick => tick + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active]);
}

/** Abrir otro servicio (o cruzar el corte de 900 px) cierra la hoja de conversación. */
export function useChatSheetReset(service: string | null, narrow: boolean): void {
  useLayoutEffect(() => {
    if (useUiStore.getState().chatSheetOpen) setUi({ chatSheetOpen: false });
  }, [service, narrow]);
}

/** Los botones que abren el panel de hilos (también los de otros servicios) dicen si está abierto. */
export function useNavExpandedSync(open: boolean): void {
  useEffect(() => {
    document.querySelectorAll('[aria-controls="nav-drawer"]').forEach(button => button.setAttribute('aria-expanded', String(open)));
  }, [open]);
}
