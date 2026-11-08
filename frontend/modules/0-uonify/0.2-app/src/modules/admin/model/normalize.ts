import type {
  AdminPlan,
  ArticlePlan,
  ArticleStatus,
  BillingConfigView,
  ConfigValue,
  HelpArticle,
  HelpConfigView,
  SupportTicket,
  TicketMessage,
  TicketStatus,
  TranscriptTurn,
} from './types';

/**
 * Lectura tolerante de lo que devuelven billing (/billing/*) y help (/help/*,
 * /support/*). Esos módulos definen sus formas (sus model/types.ts); admin las lee
 * aceptando también los nombres de campo habituales y, al guardar, devuelve el objeto
 * original con los campos cambiados.
 */
export type Json = Record<string, unknown>;

export const isJson = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);

/** Lista a partir de `[...]` o `{ <clave>: [...] }` (o `{ data | items | results: [...] }`). */
export function listFrom(payload: unknown, key: string): Json[] {
  if (Array.isArray(payload)) return payload.filter(isJson);
  if (!isJson(payload)) return [];
  for (const candidate of [key, 'data', 'items', 'results']) {
    const value = payload[candidate];
    if (Array.isArray(value)) return value.filter(isJson);
  }
  return [];
}

/** Objeto a partir de `{...}` o `{ <clave>: {...} }`. */
export function objectFrom(payload: unknown, key: string): Json {
  if (!isJson(payload)) return {};
  const nested = payload[key];
  return isJson(nested) ? nested : payload;
}

function pick(source: Json, keys: string[]): { key: string; value: unknown } | null {
  for (const key of keys) if (key in source && source[key] !== undefined) return { key, value: source[key] };
  return null;
}

function text(source: Json, keys: string[], fallback = ''): string {
  const found = pick(source, keys);
  return found && (typeof found.value === 'string' || typeof found.value === 'number') ? String(found.value) : fallback;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

function configValue(source: Json, keys: string[]): ConfigValue {
  const found = pick(source, keys);
  return { key: found?.key ?? keys[0], value: found ? num(found.value) : null };
}

// ── Billing ─────────────────────────────────────────────────────────────────

export function normalizePlan(raw: Json): AdminPlan {
  const price = pick(raw, ['monthlyPrice', 'priceMonthly', 'price']);
  const seats = pick(raw, ['seats', 'users', 'maxSeats']);
  return {
    id: text(raw, ['id', 'planId']),
    name: text(raw, ['name', 'label'], 'Plan'),
    monthlyPrice: price ? num(price.value) : null,
    monthsPerYear: num(raw.monthsPerYear) ?? 12,
    seats: seats ? num(seats.value) : null,
    limits: text(raw, ['limits', 'limitsText']),
    description: text(raw, ['description', 'summary']),
    includedTokens: num(raw.includedTokens),
    popular: raw.popular === true,
    contactSales: raw.contactSales === true || (price !== null && price.value === null),
    raw,
  };
}

export function normalizePlans(payload: unknown): AdminPlan[] {
  return listFrom(payload, 'plans').map(normalizePlan).filter(plan => plan.id);
}

const MIN_TOP_UP_KEYS = ['minRecharge', 'minTopUp', 'minTopUpEur', 'minimumTopUp', 'minRechargeEur'];
const MAX_TOP_UP_KEYS = ['maxRecharge', 'maxTopUp', 'maxTopUpEur'];
const PATRON_KEYS = ['supportAmount', 'patronAmount', 'patronAmountEur', 'supportAmountEur', 'apoyaAmount'];

export function normalizeBillingConfig(payload: unknown): BillingConfigView {
  const raw = objectFrom(payload, 'config');
  const max = configValue(raw, MAX_TOP_UP_KEYS);
  return {
    minTopUp: configValue(raw, MIN_TOP_UP_KEYS),
    maxTopUp: max.value === null ? null : max,
    patronAmount: configValue(raw, PATRON_KEYS),
    raw,
  };
}

// ── Help: configuración ─────────────────────────────────────────────────────

/** La videollamada vive en `config.videocall` (help) o en claves planas. */
export function normalizeHelpConfig(payload: unknown): HelpConfigView {
  const raw = objectFrom(payload, 'config');
  const call = isJson(raw.videocall) ? raw.videocall : raw;
  const price = pick(call, ['priceEur', 'price', 'videoCallPriceEur', 'videoCallPrice']);
  const minutes = pick(call, ['durationMin', 'durationMinutes', 'videoCallMinutes']);
  const vat = pick(call, ['vatIncluded']);
  return {
    videoCallPrice: price ? num(price.value) : null,
    videoCallMinutes: minutes ? num(minutes.value) : null,
    vatIncluded: vat && typeof vat.value === 'boolean' ? vat.value : null,
    raw,
  };
}

/** Configuración de help con el precio nuevo, en la misma forma que llegó. */
export function withVideoCallPrice(config: HelpConfigView, price: number): Json {
  const raw = config.raw;
  if (isJson(raw.videocall)) return { ...raw, videocall: { ...raw.videocall, priceEur: price } };
  const flat = pick(raw, ['videoCallPriceEur', 'videoCallPrice', 'priceEur', 'price']);
  return { ...raw, [flat?.key ?? 'videoCallPriceEur']: price };
}

// ── Help: artículos ─────────────────────────────────────────────────────────

function articleStatus(raw: Json, meta: Json): ArticleStatus {
  const status = text(meta, ['status']) || text(raw, ['status']);
  if (status) return status === 'published' || status === 'publicado' ? 'published' : 'draft';
  if (typeof raw.published === 'boolean') return raw.published ? 'published' : 'draft';
  return 'published';
}

function collectionOf(raw: Json, meta: Json): string {
  const found = pick(meta, ['collection']) ?? pick(raw, ['collection', 'category', 'collectionId']);
  if (!found) return '';
  if (typeof found.value === 'string') return found.value;
  return isJson(found.value) ? text(found.value, ['id', 'title', 'name']) : '';
}

export function normalizeArticle(raw: Json): HelpArticle {
  const meta = isJson(raw.metadata) ? raw.metadata : {};
  const plan = text(meta, ['plan']) || text(raw, ['plan']);
  const slug = text(raw, ['slug', 'id']);
  return {
    id: slug || text(raw, ['id']),
    slug,
    title: text(raw, ['title', 'name'], 'Sin título'),
    summary: text(raw, ['summary', 'excerpt', 'description']),
    body: text(raw, ['body', 'content', 'markdown']),
    collection: collectionOf(raw, meta),
    status: articleStatus(raw, meta),
    plan: (['all', 'paid', 'free'].includes(plan) ? plan : 'all') as ArticlePlan,
    keywords: strings(raw.keywords),
    assistantNotes: strings(raw.assistantNotes),
    updatedAt: text(meta, ['updatedAt']) || text(raw, ['updatedAt', 'publishedAt', 'createdAt']),
    helpful: num(raw.helpful) ?? 0,
    notHelpful: num(raw.notHelpful) ?? 0,
    raw,
  };
}

export function normalizeArticles(payload: unknown): HelpArticle[] {
  return listFrom(payload, 'articles').map(normalizeArticle).filter(article => article.id);
}

// ── Help: tickets ───────────────────────────────────────────────────────────

const TICKET_STATUSES: Record<string, TicketStatus> = {
  open: 'open', new: 'open', abierto: 'open',
  answered: 'answered', pending: 'answered', waiting: 'answered', respondido: 'answered',
  closed: 'closed', solved: 'closed', resolved: 'closed', cerrado: 'closed',
};

function messageAuthor(raw: Json): TicketMessage['author'] {
  const value = text(raw, ['author', 'from', 'role', 'sender']).toLowerCase();
  if (['uony', 'assistant', 'bot'].includes(value)) return 'uony';
  if (['team', 'agent', 'support', 'staff', 'admin'].includes(value)) return 'team';
  return 'customer';
}

const AUTHOR_NAMES: Record<TicketMessage['author'], string> = { customer: 'Cliente', team: 'Equipo de Uonify', uony: 'Uony' };

function normalizeMessage(raw: Json, index: number): TicketMessage {
  const author = messageAuthor(raw);
  return {
    id: text(raw, ['id'], `m${index}`),
    author,
    authorName: text(raw, ['authorName', 'name'], AUTHOR_NAMES[author]),
    body: text(raw, ['body', 'text', 'message', 'content']),
    at: text(raw, ['createdAt', 'at', 'sentAt', 'date']),
  };
}

function normalizeTurn(raw: Json): TranscriptTurn {
  const role = text(raw, ['role', 'author']).toLowerCase();
  return { role: role === 'uony' || role === 'assistant' ? 'uony' : 'user', text: text(raw, ['text', 'body', 'content']) };
}

export function normalizeTicket(payload: unknown): SupportTicket {
  const raw = objectFrom(payload, 'ticket');
  const outer = isJson(payload) ? payload : {};
  const customer = isJson(raw.customer) ? raw.customer : isJson(raw.requester) ? raw.requester : {};
  const messages = listFrom(Array.isArray(raw.messages) ? raw.messages : outer.messages, 'messages').map(normalizeMessage);
  const transcript = listFrom(Array.isArray(raw.transcript) ? raw.transcript : outer.transcript, 'transcript').map(normalizeTurn);
  const source = text(raw, ['source', 'origin', 'channel']).toLowerCase();
  const createdAt = text(raw, ['createdAt', 'openedAt', 'date']);
  const id = text(raw, ['id', 'ticketId', 'number']);
  return {
    id,
    number: text(raw, ['number', 'reference'], id),
    subject: text(raw, ['subject', 'title'], 'Sin asunto'),
    status: TICKET_STATUSES[text(raw, ['status', 'state']).toLowerCase()] ?? 'open',
    category: text(raw, ['category', 'topic']),
    source,
    customerEmail: text(raw, ['customerEmail', 'email', 'requesterEmail']) || text(customer, ['email']),
    customerName: text(raw, ['customerName', 'requesterName', 'accountName']) || text(customer, ['name', 'company']),
    createdAt,
    updatedAt: text(raw, ['updatedAt', 'lastMessageAt'], createdAt),
    lastMessage: text(raw, ['lastMessage'], messages[messages.length - 1]?.body ?? ''),
    fromUony: source === 'uony' || source === 'assistant' || raw.escalated === true || transcript.length > 0,
    messages,
    transcript,
  };
}

export function normalizeTickets(payload: unknown): SupportTicket[] {
  return listFrom(payload, 'tickets').map(ticket => normalizeTicket(ticket)).filter(ticket => ticket.id);
}
