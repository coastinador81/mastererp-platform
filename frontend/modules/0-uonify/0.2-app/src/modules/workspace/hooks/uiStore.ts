import type { LiveWorkIntent } from '../api/liveTransport';
import { useLayoutEffect, type RefObject } from 'react';
import { create } from 'zustand';
import type { LimitReason } from '../model/aiLimit';
import { parseWorkspacePath, type WorkspaceRoute } from '../model/services';

/**
 * Estado de interfaz del espacio que no se guarda: paneles abiertos, respuesta
 * en curso de Uony, hoja de conversación en móvil y los enganches que usan los
 * servicios (portal del centro de la cabecera, conversación centrada).
 */
export interface PendingReply {
  threadId: string;
  requestId?: string;
  label: string;
  /** Solo describe un trabajo confirmado por el servidor; no se infiere de una promesa verbal. */
  purpose?: LiveWorkIntent;
  /** La preparación Amazon usa el indicador del compositor o la pregunta que se está enviando. */
  requirements?: { formId?: string };
}

/** F1-S (lote 8): la respuesta escrita mientras Uony la escribe; la sustituye la definitiva o el aviso. */
export interface ProvisionalReply {
  threadId: string;
  requestId: string;
  text: string;
  seq: number;
}

export interface WorkspaceUiState {
  /** Servicio y vista actuales, leídos de la URL por el layout. */
  route: WorkspaceRoute;
  navOpen: boolean;
  servicesOpen: boolean;
  accountOpen: boolean;
  /** Diálogo del límite del plan de ChatGPT abierto, y por qué se abrió. */
  limitDialog: LimitReason | null;
  /** Hoja de conversación en pantallas estrechas: empieza cerrada en cada servicio. */
  chatSheetOpen: boolean;
  pendingReply: PendingReply | null;
  provisionalReply: ProvisionalReply | null;
  /** Región viva (sr-only) que anuncia cada paso de la respuesta. */
  liveText: string;
  /** Conversaciones pintadas por un servicio dentro de su vista (centradas). */
  embeddedDocks: number;
  topbarCenterNode: HTMLElement | null;
  topbarCenterCount: number;
  /** Nombre del producto de la ficha abierta (lo aporta catalog). */
  sheetTitle: string | null;
  /** Ancho del panel mientras se arrastra su borde (se guarda al soltar). */
  chatDragWidth: number | null;
}

export const useUiStore = create<WorkspaceUiState>()(() => ({
  route: parseWorkspacePath(typeof window === 'undefined' ? '/espacio' : window.location.pathname),
  navOpen: false,
  servicesOpen: false,
  accountOpen: false,
  limitDialog: null,
  chatSheetOpen: false,
  pendingReply: null,
  provisionalReply: null,
  liveText: '',
  embeddedDocks: 0,
  topbarCenterNode: null,
  topbarCenterCount: 0,
  sheetTitle: null,
  chatDragWidth: null,
}));

export const setUi = (patch: Partial<WorkspaceUiState> | ((state: WorkspaceUiState) => Partial<WorkspaceUiState>)) =>
  useUiStore.setState(patch);

/** Elementos del marco a los que va o vuelve el foco (en el PROTO, referencias del DOM). */
export interface DomRefs {
  column: HTMLDivElement | null;
  workspace: HTMLElement | null;
  dock: HTMLElement | null;
  conversationContent: HTMLDivElement | null;
  messages: HTMLDivElement | null;
  composer: HTMLFormElement | null;
  draft: HTMLTextAreaElement | null;
  chatToggle: HTMLButtonElement | null;
  chatFab: HTMLButtonElement | null;
  servicesTrigger: HTMLButtonElement | null;
  accountButton: HTMLButtonElement | null;
  /** Franja del pie global, al final de la columna (ver `visibleBottom`). */
  footer: HTMLDivElement | null;
}

/**
 * Enganches no reactivos: la función de navegación del router, a quién vuelve el
 * foco y los elementos del marco.
 */
export const workspaceRefs: DomRefs & {
  navigate: (to: string, options?: { replace?: boolean }) => void;
  navReturnFocus: HTMLElement | null;
} = {
  navigate: () => {},
  navReturnFocus: null,
  column: null,
  workspace: null,
  dock: null,
  conversationContent: null,
  messages: null,
  composer: null,
  draft: null,
  chatToggle: null,
  chatFab: null,
  servicesTrigger: null,
  accountButton: null,
  footer: null,
};

/**
 * Borde inferior de lo visible para los menús que se colocan según la pantalla (los del
 * compositor): la ventana o, en el espacio, el comienzo del pie global, que siempre está a
 * la vista y no deben tapar ni cortar. Con la hoja de la conversación abierta (móvil), la
 * hoja tapa el pie y cuenta la ventana, como en el CSS (.is-chat-sheet no descuenta el pie).
 * Sin maquetar (arriba en 0, como en las pruebas), también cuenta la ventana.
 */
export function visibleBottom(): number {
  if (workspaceRefs.column?.classList.contains('is-chat-sheet')) return window.innerHeight;
  const top = workspaceRefs.footer?.getBoundingClientRect().top ?? 0;
  return top > 0 ? Math.min(window.innerHeight, top) : window.innerHeight;
}

/**
 * Publica un elemento del marco mientras está montado. Si dos instancias
 * conviven un momento (la conversación cambia de sitio), la que se desmonta no
 * borra la de la otra.
 */
export function useRegisterRef<K extends keyof DomRefs>(key: K, ref: RefObject<DomRefs[K]>): void {
  useLayoutEffect(() => {
    const refs: DomRefs = workspaceRefs;
    const element = ref.current;
    refs[key] = element;
    return () => {
      if (refs[key] === element) refs[key] = null as DomRefs[K];
    };
  }, [key, ref]);
}

let liveTimer: ReturnType<typeof setTimeout> | undefined;
/** Se vacía y se rellena un momento después para que los lectores anuncien cada paso. */
export function announce(text: string): void {
  setUi({ liveText: '' });
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => setUi({ liveText: text }), 40);
}

/** Un elemento al que se puede devolver el foco (visible, conectado, no inerte). */
export function usable(element: HTMLElement | null | undefined): element is HTMLElement {
  return Boolean(element && !element.hidden && element.isConnected && !element.closest('[inert]') && !element.closest('[hidden]'));
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => {
  clearTimeout(liveTimer);
  setUi({ pendingReply: null, provisionalReply: null, liveText: '', sheetTitle: null, navOpen: false, servicesOpen: false,
    accountOpen: false, limitDialog: null, chatSheetOpen: false });
});
