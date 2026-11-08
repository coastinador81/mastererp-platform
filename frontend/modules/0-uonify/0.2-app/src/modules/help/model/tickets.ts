/**
 * Tickets de soporte («Mis tickets»). Reglas del historial de Rentprivé: se ordena
 * por la última actividad y lo cerrado no se oculta (es el registro de la atención
 * recibida). Estados: abierto · respondido · cerrado.
 */
import type { BadgeTone } from '@/shared/ui';
import type { TicketCategory, TicketInput, TicketSource, TicketStatus, TicketSummary, TranscriptTurn } from './types';

export const TICKET_STATUS: Record<TicketStatus, { label: string; tone: BadgeTone; hint: string }> = {
  open: { label: 'Abierto', tone: 'blue', hint: 'Lo estamos revisando' },
  answered: { label: 'Respondido', tone: 'green', hint: 'Tienes una respuesta del equipo' },
  closed: { label: 'Cerrado', tone: 'neutral', hint: 'Resuelto' },
};

export const TICKET_CATEGORIES: Record<TicketCategory, string> = {
  account: 'Cuenta y acceso',
  billing: 'Planes, tokens y facturación',
  amazon: 'Conexión con Amazon',
  catalog: 'Catálogo y fichas',
  ai: 'Uony y contenido con IA',
  privacy: 'Privacidad y datos',
  other: 'Otro tema',
};

export const TICKET_SOURCES: Record<TicketSource, string> = {
  uony: 'Desde Uony de soporte',
  form: 'Formulario de ayuda',
  email: 'Correo a hola@uonify.com',
  videocall: 'Videollamada',
};

export const SUBJECT_MAX = 120;
export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 4000;
/** Mensajes de la conversación con Uony que se adjuntan, y su largo máximo. */
export const TRANSCRIPT_TURNS = 10;
export const TRANSCRIPT_CHARS = 400;

export function isTicketCategory(value: unknown): value is TicketCategory {
  return typeof value === 'string' && value in TICKET_CATEGORIES;
}

/** Más reciente primero; ante empate, los abiertos antes. Nada se oculta. */
export function sortTickets<T extends Pick<TicketSummary, 'updatedAt' | 'status'>>(tickets: T[]): T[] {
  const rank: Record<TicketStatus, number> = { answered: 0, open: 1, closed: 2 };
  return [...tickets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || rank[a.status] - rank[b.status]);
}

/** Tickets con algo pendiente para la persona o para el equipo. */
export function activeCount(tickets: Pick<TicketSummary, 'status'>[]): number {
  return tickets.filter(ticket => ticket.status !== 'closed').length;
}

/** Últimos mensajes de la conversación, recortados, para adjuntarlos al ticket. */
export function trimTranscript(turns: TranscriptTurn[]): TranscriptTurn[] {
  return turns
    .filter(turn => turn.text.trim())
    .slice(-TRANSCRIPT_TURNS)
    .map(turn => ({ role: turn.role, text: turn.text.length > TRANSCRIPT_CHARS ? `${turn.text.slice(0, TRANSCRIPT_CHARS - 1)}…` : turn.text }));
}

export type TicketErrors = Partial<Record<'subject' | 'message' | 'category', string>>;

/** Errores del formulario, en español (vacío si todo está bien). */
export function validateTicket(input: Pick<TicketInput, 'subject' | 'message' | 'category'>): TicketErrors {
  const errors: TicketErrors = {};
  const subject = input.subject.trim();
  const message = input.message.trim();
  if (!subject) errors.subject = 'Escribe un asunto.';
  else if (subject.length > SUBJECT_MAX) errors.subject = `El asunto admite como máximo ${SUBJECT_MAX} caracteres.`;
  if (!isTicketCategory(input.category)) errors.category = 'Elige un tema.';
  if (message.length < MESSAGE_MIN) errors.message = 'Cuéntanos un poco más: al menos 10 caracteres.';
  else if (message.length > MESSAGE_MAX) errors.message = `El mensaje admite como máximo ${MESSAGE_MAX} caracteres.`;
  return errors;
}
