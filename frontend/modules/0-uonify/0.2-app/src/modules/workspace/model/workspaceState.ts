import { isServiceId, type ServiceId } from './services';
import type { ConnectionAction } from './connectionActions';
import { conversationFormOf, type ConversationFormData } from './conversationForm';
import { materialAnalysisOf, type MaterialAnalysisContext } from './materialAnalysis';
import { productIntakeOf, type ProductIntakeContext } from './productIntake';
import { productProposalForThread, type ProductProposal } from './productProposal';
import { estudioCardOf, type EstudioCard } from './estudioCard';

/**
 * Datos del espacio de trabajo: hilos y preferencias ligeras del panel.
 * Origen: `initialState` y la restauración de app-shell.js (sessionStorage
 * «uonify-home-workspace-v1»). Los productos, canales y el ejemplo del PROTO son
 * del módulo catalog y ya no viajan aquí. Los proyectos reales se guardan en
 * PostgreSQL; los datos históricos del PROTO no se importan como proyectos reales.
 */
export const WORKSPACE_STORAGE_KEY = 'uonify-home-workspace-v1';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  /** Identidad interna del envío para reconciliar recargas sin duplicar mensajes. */
  requestId?: string;
  /** Identidad de un turno Live ya persistido por el servidor. */
  turnId?: string;
  /** Turno de la persona al que responde una frase de Live; permite retirar solo esa frase tras un handoff. */
  replyToTurnId?: string | null;
  /** Turno Live que inició una respuesta definitiva del trabajador. */
  sourceLiveTurnId?: string;
  /** La respuesta Live quedó sustituida por el trabajo del mismo turno. */
  supersededByHandoff?: boolean;
  /** Un fallo del proveedor no se presenta como respuesta generada por Gemini. */
  requestStatus?: 'unknown' | 'error' | 'cancelled';
  productChanges?: import('@/shared/pim').ProductChange[];
  connectionActions?: ConnectionAction[];
  conversationForm?: ConversationFormData;
  materialAnalysis?: MaterialAnalysisContext;
  productIntake?: ProductIntakeContext;
  productProposal?: ProductProposal;
  /** Tarjeta del Estudio en el chat (plan, creándose, resultado, imágenes, publicar). */
  estudioCard?: EstudioCard;
  /** Solo una entrega nueva abre las preguntas; el historial espera la acción del cliente. */
  conversationFormFresh?: boolean;
  role: ChatRole;
  text: string;
  /** Opciones de IA con las que se envió (solo mensajes de la persona). */
  model?: string;
  effort?: string;
  speed?: string;
}

export interface Thread {
  id: string;
  title: string;
  projectId?: string | null;
  /** Servicio y vista donde sigue el hilo (al elegirlo se vuelve allí). */
  service: ServiceId | null;
  view: string;
  messages: ChatMessage[];
}

export interface WorkspaceData {
  threads: Thread[];
  activeThreadId: string | null;
  activeProjectId: string | null;
  conversationExpanded: boolean;
  chatPanelCollapsed: boolean;
  chatPanelWidth: number | null;
}

export function initialWorkspace(): WorkspaceData {
  return {
    threads: [],
    activeThreadId: null,
    activeProjectId: null,
    conversationExpanded: false,
    chatPanelCollapsed: false,
    chatPanelWidth: null,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function toThread(item: Record<string, unknown>): Thread {
  const messages = (item.messages as unknown[])
    .filter(isRecord)
    .filter(message => typeof message.text === 'string')
    .map(message => ({ ...(message as unknown as ChatMessage), role: message.role === 'user' ? 'user' as const : 'assistant' as const,
      conversationForm: conversationFormOf(message.conversationForm, message.role),
      materialAnalysis: materialAnalysisOf(message.materialAnalysis, message.role),
      productIntake: productIntakeOf(message.productIntake, message.role),
      productProposal: productProposalForThread(message.productProposal, message.role, item.id as string),
      estudioCard: estudioCardOf(message.estudioCard, message.role),
      conversationFormFresh: undefined,
    }));
  return {
    id: item.id as string,
    title: item.title as string,
    service: isServiceId(item.service) ? item.service : null,
    view: typeof item.view === 'string' ? item.view : 'default',
    messages,
  };
}

/**
 * Una recarga vuelve a un inicio limpio, como una entrada nueva: la navegación y
 * la selección (hilo abierto) NO se restauran y quedan con los valores de
 * `initialWorkspace()`. Solo se conservan los datos duraderos (hilos) y las
 * preferencias ligeras. `?service=` sigue pudiendo abrir
 * un servicio (lo resuelve la entrada del espacio, ver model/entry.ts).
 */
export function restoreWorkspace(saved: unknown): WorkspaceData {
  const state = initialWorkspace();
  if (!isRecord(saved) || !Array.isArray(saved.threads)) return state;
  const width = saved.chatPanelWidth;
  return {
    ...state,
    threads: saved.threads
      .filter(isRecord)
      .filter(item => typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.messages))
      .slice(0, 80)
      .map(toThread),
    chatPanelWidth: typeof width === 'number' && Number.isFinite(width) && width >= 360 ? Math.min(640, width) : null,
  };
}

export function readSavedWorkspace(storage: Pick<Storage, 'getItem'> | undefined = globalThis.sessionStorage): WorkspaceData {
  try {
    return restoreWorkspace(JSON.parse(storage?.getItem(WORKSPACE_STORAGE_KEY) || 'null'));
  } catch {
    return initialWorkspace(); // El almacenamiento del navegador es opcional.
  }
}

export function saveWorkspace(data: WorkspaceData, storage: Pick<Storage, 'setItem'> | undefined = globalThis.sessionStorage): void {
  try {
    storage?.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* La pantalla sigue siendo usable sin almacenamiento. */
  }
}

/** Título de un hilo nuevo a partir del primer mensaje (36 caracteres). */
export function threadTitle(text: string): string {
  return text.length > 36 ? `${text.slice(0, 36).trimEnd()}…` : text;
}

export function newThreadId(now = Date.now()): string {
  return `thread-${now}-${Math.random().toString(36).slice(2, 6)}`;
}
