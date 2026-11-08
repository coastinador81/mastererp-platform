/**
 * Tipos de la ayuda de Uonify: artículos, colecciones, configuración, tickets,
 * videollamadas y el asistente Uony de soporte. Son el contrato con el backend
 * (rutas en api/paths.ts, simulación en mocks/).
 *
 * Formato de los artículos: el de la biblioteca de conocimiento de Rentprivé
 * (Markdown con `## Pregunta` + respuesta y una ficha de metadatos), ampliado con
 * colección, slug, plan y fecha. El mismo artículo publica el centro de ayuda y
 * alimenta a Uony.
 */

// ── Artículos ──────────────────────────────────────────────────────────────

export type ArticleStatus = 'published' | 'draft';

/** Ficha de metadatos (el `.md.metadata.json` de Rentprivé, ampliado). */
export interface ArticleMetadata {
  collection: string;
  /** Público del artículo: vendedores de Amazon y marcas. */
  audience: 'seller';
  topic: string;
  /** Plan al que aplica («all» si a todos). */
  plan: 'all' | 'paid' | 'free';
  status: ArticleStatus;
  /** Fecha de la última revisión (AAAA-MM-DD). */
  updatedAt: string;
}

/** Artículo completo, tal como lo devuelve GET /help/articles/:slug. */
export interface HelpArticle {
  slug: string;
  title: string;
  /** Resumen de una o dos frases (entradilla y meta description). */
  summary: string;
  /** Cuerpo en Markdown: secciones `## Pregunta` con su respuesta. */
  body: string;
  /** Palabras con las que la gente lo busca (no se muestran). */
  keywords: string[];
  /** Lo que Uony no debe asumir (como «Lo que Vera no debe asumir»). No se publica. */
  assistantNotes: string[];
  metadata: ArticleMetadata;
  /** Orden dentro de su colección. */
  order: number;
  views: number;
  helpful: number;
  notHelpful: number;
}

/** Artículo en listados (sin cuerpo). */
export type HelpArticleSummary = Omit<HelpArticle, 'body' | 'assistantNotes'>;

/** Datos que envía admin para crear o editar un artículo. */
export interface HelpArticleInput {
  slug: string;
  title: string;
  summary: string;
  body: string;
  keywords?: string[];
  assistantNotes?: string[];
  collection: string;
  topic?: string;
  plan?: ArticleMetadata['plan'];
  status?: ArticleStatus;
  order?: number;
}

export interface HelpCollection {
  id: string;
  title: string;
  description: string;
  /** Icono del kit (@/shared/ui) o de la ayuda (hlp-*). */
  icon: string;
  order: number;
  /** Artículos publicados (lo calcula el servidor). */
  articleCount?: number;
}

// ── Búsqueda ───────────────────────────────────────────────────────────────

/** Trozo de texto con las coincidencias marcadas (para <mark>). */
export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface SearchResult {
  slug: string;
  title: string;
  summary: string;
  collection: string;
  score: number;
  /** Sección donde está la coincidencia (título `##`), si la hay. */
  section: string | null;
  snippet: SnippetPart[];
}

export interface SearchResponse {
  query: string;
  total: number;
  results: SearchResult[];
}

// ── Configuración (editable desde admin: GET/PUT /help/config) ────────────

export interface TimeWindow {
  /** «HH:MM» en la zona horaria de la agenda. */
  from: string;
  to: string;
}

export interface VideocallConfig {
  enabled: boolean;
  /** Precio de la sesión en euros. */
  priceEur: number;
  /** Si el precio incluye el IVA. */
  vatIncluded: boolean;
  durationMin: number;
  /** Zona horaria de la agenda del equipo (IANA). */
  timezone: string;
  /** Días con agenda: 0 domingo … 6 sábado. */
  weekdays: number[];
  windows: TimeWindow[];
  /** Antelación mínima para reservar. */
  minNoticeHours: number;
  /** Días que se pueden reservar por delante. */
  horizonDays: number;
  /** Hasta cuántas horas antes se puede cancelar con devolución. */
  cancelNoticeHours: number;
}

export interface HelpConfig {
  contactEmail: string;
  /** Uony de soporte activo (se puede apagar desde admin). */
  assistantEnabled: boolean;
  videocall: VideocallConfig;
  updatedAt: string;
}

// ── Tickets (/support/tickets) ─────────────────────────────────────────────

export type TicketStatus = 'open' | 'answered' | 'closed';
export type TicketSource = 'uony' | 'form' | 'email' | 'videocall';
export type TicketCategory = 'account' | 'billing' | 'amazon' | 'catalog' | 'ai' | 'privacy' | 'other';

export interface TranscriptTurn {
  role: 'user' | 'uony';
  text: string;
}

export interface TicketMessage {
  id: string;
  author: 'customer' | 'team';
  authorName: string;
  body: string;
  createdAt: string;
}

export interface TicketSummary {
  id: string;
  /** Referencia legible (UON-1042). */
  number: string;
  subject: string;
  category: TicketCategory;
  source: TicketSource;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
  /** Hay una respuesta del equipo sin leer. */
  unread: boolean;
}

export interface Ticket extends TicketSummary {
  messages: TicketMessage[];
  /** Conversación con Uony adjunta (ya tachada). */
  transcript: TranscriptTurn[];
}

export interface TicketInput {
  subject: string;
  category: TicketCategory;
  message: string;
  source: TicketSource;
  conversationId?: string;
  transcript?: TranscriptTurn[];
}

// ── Videollamadas (/support/videocall/slots, /support/bookings) ───────────

export type BookingTopic = 'onboarding' | 'amazon' | 'content' | 'billing' | 'other';
export type BookingStatus = 'pending_payment' | 'confirmed' | 'cancelled' | 'completed' | 'expired';

export interface Slot {
  /** Inicio en ISO (UTC). */
  start: string;
  available: boolean;
}

export interface SlotDay {
  /** Fecha en la zona de la agenda (AAAA-MM-DD). */
  date: string;
  slots: Slot[];
}

export interface SlotsResponse {
  timezone: string;
  durationMin: number;
  priceEur: number;
  vatIncluded: boolean;
  days: SlotDay[];
}

export interface Booking {
  id: string;
  start: string;
  end: string;
  durationMin: number;
  timezone: string;
  topic: BookingTopic;
  notes: string;
  priceEur: number;
  status: BookingStatus;
  createdAt: string;
  /** Hasta cuándo se guarda el hueco sin pagar. */
  holdExpiresAt: string | null;
  meetUrl: string | null;
  paidAt: string | null;
  receiptNumber: string | null;
  cancelledAt: string | null;
  refunded: boolean;
}

export interface BookingInput {
  start: string;
  topic: BookingTopic;
  notes?: string;
}

// ── Uony de soporte (POST /support/assistant/messages, NDJSON) ────────────

export interface SourceRef {
  slug: string;
  title: string;
}

/** Motivos tipificados de derivación a una persona (bandeja de derivaciones). */
export type HandoffReason = 'requested' | 'complaint' | 'data_rights' | 'account_specific' | 'unresolved' | 'sensitive_data';

export interface Handoff {
  reason: HandoffReason;
  /** Asunto propuesto para el ticket. */
  subject: string;
  category: TicketCategory;
}

export interface AssistantRequest {
  conversationId?: string;
  message: string;
  context?: { page?: string; articleSlug?: string };
}

/** Eventos del flujo, una línea JSON por evento. */
export type AssistantEvent =
  | { type: 'meta'; conversationId: string; redactedMessage: string; redacted: boolean; sources: SourceRef[] }
  | { type: 'delta'; text: string }
  | { type: 'done'; handoff: Handoff | null; filtered: boolean }
  | { type: 'error'; message: string };
