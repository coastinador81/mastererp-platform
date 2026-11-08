import { create } from 'zustand';
import type { TicketCategory, TicketSource, TranscriptTurn } from '../model/types';

/**
 * Estado del panel de soporte: abierto o cerrado y la pila de vistas (para «Atrás»).
 * Lo abren el botón «Ayuda» de la cabecera, el centro de ayuda y, desde fuera del
 * módulo, openHelp() (p. ej. el menú de cuenta o Configuración › Ayuda).
 */
export interface TicketPrefill {
  subject?: string;
  category?: TicketCategory;
  message?: string;
  source?: TicketSource;
  conversationId?: string;
  transcript?: TranscriptTurn[];
}

export type PanelRoute =
  | { view: 'home' }
  | { view: 'article'; slug: string }
  | { view: 'chat' }
  | { view: 'tickets' }
  | { view: 'ticket'; id: string; created?: boolean }
  | { view: 'new-ticket'; prefill?: TicketPrefill }
  | { view: 'booking' };

/** Vistas que se pueden abrir desde fuera del módulo. */
export type HelpView = 'home' | 'chat' | 'tickets' | 'new-ticket' | 'booking';

interface PanelState {
  open: boolean;
  stack: PanelRoute[];
}

const HOME: PanelRoute = { view: 'home' };

export const usePanelStore = create<PanelState>(() => ({ open: false, stack: [HOME] }));

export function currentRoute(state: PanelState = usePanelStore.getState()): PanelRoute {
  return state.stack[state.stack.length - 1] ?? HOME;
}

/** Abre el panel en una vista (con «Inicio» debajo para poder volver). */
export function openPanel(route: PanelRoute = HOME): void {
  usePanelStore.setState({ open: true, stack: route.view === 'home' ? [HOME] : [HOME, route] });
}

export function openHelp(view: HelpView = 'home'): void {
  openPanel({ view } as PanelRoute);
}

export function openHelpArticle(slug: string): void {
  openPanel({ view: 'article', slug });
}

export function closePanel(): void {
  usePanelStore.setState({ open: false });
}

export function navigate(route: PanelRoute): void {
  usePanelStore.setState(state => ({ stack: [...state.stack, route] }));
}

/** Sustituye la vista actual (p. ej. el formulario por el ticket creado). */
export function replaceRoute(route: PanelRoute): void {
  usePanelStore.setState(state => ({ stack: [...state.stack.slice(0, -1), route] }));
}

export function back(): void {
  usePanelStore.setState(state => ({ stack: state.stack.length > 1 ? state.stack.slice(0, -1) : [HOME] }));
}

export function goHome(): void {
  usePanelStore.setState({ stack: [HOME] });
}
