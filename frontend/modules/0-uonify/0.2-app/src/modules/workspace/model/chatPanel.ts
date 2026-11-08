import type { ServiceId } from './services';

/**
 * Disposición de la conversación (app-shell.js, `chatPanelVisible` y
 * `syncChatPanel`), estilo VS Code: centrada mientras solo es un chat; un panel a
 * la derecha mientras Uony enseña un servicio; una hoja sobre él en pantallas
 * estrechas (≤ 900 px). Producto sin ficha la lleva centrada dentro de su vista.
 */
export const NARROW_CHAT_QUERY = '(max-width: 900px)';
export const CHAT_MIN_WIDTH = 360;
export const CHAT_MAX_WIDTH = 640;

export interface ChatPanelInput {
  service: ServiceId | null;
  /** La conversación está centrada dentro del servicio (Producto sin ficha). */
  centred: boolean;
  narrow: boolean;
  sheetOpen: boolean;
  collapsed: boolean;
}

export function chatPanelVisible({ service, centred, narrow, sheetOpen, collapsed }: ChatPanelInput): boolean {
  if (!service || centred) return true;
  return narrow ? sheetOpen : !collapsed;
}

export interface ChatLayout {
  isModule: boolean;
  centred: boolean;
  sidePanel: boolean;
  open: boolean;
  sheet: boolean;
  /** Clases de .workspace-column. */
  columnClasses: { 'is-module': boolean; 'is-product-chat': boolean; 'is-chat-hidden': boolean; 'is-chat-sheet': boolean };
  toggleHidden: boolean;
  toggleLabel: string;
  fabHidden: boolean;
  scrimHidden: boolean;
  /** Lo de detrás de la hoja abierta queda inerte (se comporta como un diálogo). */
  backgroundInert: boolean;
}

export function chatLayout(input: ChatPanelInput): ChatLayout {
  const isModule = Boolean(input.service);
  const centred = isModule && input.centred;
  const sidePanel = isModule && !centred;
  const open = chatPanelVisible(input);
  const sheet = sidePanel && input.narrow;
  return {
    isModule,
    centred,
    sidePanel,
    open,
    sheet,
    columnClasses: {
      'is-module': isModule,
      'is-product-chat': centred,
      'is-chat-hidden': sidePanel && !open,
      'is-chat-sheet': sheet && open,
    },
    toggleHidden: !sidePanel,
    toggleLabel: open ? 'Ocultar conversación' : 'Mostrar conversación',
    fabHidden: !(sheet && !open),
    scrimHidden: !(sheet && open),
    backgroundInert: sheet && open,
  };
}

/** El borde del panel lo redimensiona: 360-640 px y siempre 480 px para el servicio. */
export function chatWidthLimits(columnWidth: number): { min: number; max: number } {
  return { min: CHAT_MIN_WIDTH, max: Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, columnWidth - 480)) };
}

export function clampChatWidth(width: number, columnWidth: number): number {
  const { min, max } = chatWidthLimits(columnWidth);
  return Math.round(Math.min(max, Math.max(min, width)));
}

/** Teclas del separador: flechas ±24 px, Inicio = máximo, Fin = mínimo. */
export function sashKeyWidth(key: string, current: number, columnWidth: number): number | undefined {
  const { min, max } = chatWidthLimits(columnWidth);
  const next: Record<string, number> = { ArrowLeft: current + 24, ArrowRight: current - 24, Home: max, End: min };
  return next[key];
}
