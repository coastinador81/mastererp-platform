/**
 * «Base de datos» simulada de la ayuda y el soporte (sessionStorage, @/shared/mocks/db).
 */
import { collection, record } from '@/shared/mocks/db';
import { SEED_ARTICLES } from '../content';
import { defaultHelpConfig } from '../model/config';
import type { Booking, HelpArticle, HelpConfig, Ticket, TranscriptTurn } from '../model/types';
import { migratePricingCopy } from './migratePricingCopy';
import { seedTickets } from './seeds';

export type StoredArticle = HelpArticle & { id: string };

export interface StoredTicket extends Ticket {
  /** Nota para el equipo con la plantilla de ticket (no se envía al cliente). */
  internalNote: string;
  conversationId: string | null;
}

export interface StoredFeedback {
  id: string;
  slug: string;
  helpful: boolean;
  comment: string | null;
  createdAt: string;
}

export interface SearchMiss {
  id: string;
  query: string;
  count: number;
  lastAt: string;
}

export interface Conversation {
  id: string;
  misses: number;
  lastQuestion: string | null;
  turns: TranscriptTurn[];
  updatedAt: string;
}

export const articlesDb = collection<StoredArticle>('help-articles', () => SEED_ARTICLES.map(article => ({ ...article, id: article.slug })));
migratePricingCopy(articlesDb);
export const configDb = record<HelpConfig>('help-config', () => defaultHelpConfig());
export const feedbackDb = collection<StoredFeedback>('help-feedback');
export const missesDb = collection<SearchMiss>('help-search-misses');
export const ticketsDb = collection<StoredTicket>('support-tickets', () => seedTickets(Date.now()));
export const bookingsDb = collection<Booking>('support-bookings');
export const conversationsDb = collection<Conversation>('support-conversations');
/** Clave de idempotencia → id creado (tickets y reservas). */
export const idempotencyDb = record<Record<string, string>>('support-idempotency', () => ({}));
export const counterDb = record<{ ticket: number; receipt: number }>('support-counters', () => ({ ticket: 1042, receipt: 120 }));

/** Quita el campo interno `id` que exige la colección. */
export function publicArticle(stored: StoredArticle): HelpArticle {
  const { id: _id, ...article } = stored;
  return article;
}

/** Quita lo que no ve el cliente. */
export function publicTicket(stored: StoredTicket): Ticket {
  const { internalNote: _note, conversationId: _conversation, ...ticket } = stored;
  return ticket;
}
