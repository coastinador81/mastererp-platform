/**
 * Motor de respuestas de Uony de soporte. En producción responde el modelo (OpenAI
 * API con Bedrock de respaldo) con recuperación sobre los artículos; esta versión
 * determinista aplica las mismas reglas (rules.ts) y es la que usa la simulación:
 * tacha datos sensibles, detecta derivaciones, responde con el mejor pasaje de los
 * artículos, los cita y pasa el control de salida.
 */
import { splitSections } from '../markdown';
import { bestPassage, buildIndex, queryTerms, search, type SearchableArticle, type SearchIndex } from '../search';
import type { Handoff, HandoffReason, SourceRef, TicketCategory } from '../types';
import { detectIntent, type Intent } from './intents';
import { checkOutput, type FilterBlock } from './outputFilter';
import { redactSensitive } from './redact';
import {
  GREETING_ANSWER, HANDOFF_CATEGORY, HANDOFF_TEXT, IDENTITY_ANSWER, INJECTION_ANSWER,
  NO_MATCH_FIRST, NO_MATCH_SECOND, SAFE_FALLBACK, SENSITIVE_WARNING, THANKS_ANSWER,
} from './rules';

export type KnowledgeArticle = SearchableArticle;

export interface TurnInput {
  message: string;
  /** Respuestas seguidas sin artículo (a la segunda se deriva). */
  misses: number;
  /** Última pregunta de la persona, para proponer el asunto del ticket. */
  lastQuestion?: string;
  /** Artículo que está leyendo, si lo hay: gana en caso de duda. */
  articleSlug?: string;
  articles: KnowledgeArticle[];
  index?: SearchIndex;
}

export interface TurnReply {
  text: string;
  sources: SourceRef[];
  handoff: Handoff | null;
  redactedMessage: string;
  redacted: boolean;
  /** El control de salida cambió la respuesta. */
  filtered: boolean;
  filterBlock: FilterBlock | null;
  misses: number;
  intent: Intent;
}

const COLLECTION_CATEGORY: Record<string, TicketCategory> = {
  'primeros-pasos': 'account',
  uony: 'ai',
  'drive-y-conexiones': 'account',
  'proyecto-google': 'billing',
  estudio: 'ai',
  amazon: 'amazon',
  'plan-y-cuenta': 'billing',
  'cuenta-datos-privacidad': 'account',
};

const REASON_SUBJECT: Record<HandoffReason, string> = {
  requested: 'Consulta para el equipo de soporte',
  complaint: 'Reclamación',
  data_rights: 'Solicitud sobre mis datos personales',
  account_specific: 'Revisión de mi cuenta',
  unresolved: 'Consulta sin resolver con Uony',
  sensitive_data: 'Consulta para el equipo de soporte',
};

const MAX_ANSWER = 720;

/** Recorta en el último final de frase antes del límite. */
function trimAnswer(text: string): string {
  if (text.length <= MAX_ANSWER) return text;
  const cut = text.slice(0, MAX_ANSWER);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return end > 200 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

function subjectFrom(question: string | undefined, reason: HandoffReason): string {
  const clean = (question ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length < 8 || detectIntent(clean) !== 'question') return REASON_SUBJECT[reason];
  const short = clean.length > 90 ? `${clean.slice(0, 89).trimEnd()}…` : clean;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function handoffFor(reason: HandoffReason, question: string | undefined, collection?: string): Handoff {
  return {
    reason,
    subject: subjectFrom(question, reason),
    category: HANDOFF_CATEGORY[reason] ?? (collection ? COLLECTION_CATEGORY[collection] : undefined) ?? 'other',
  };
}

interface Draft {
  text: string;
  sources: SourceRef[];
  handoff: Handoff | null;
  misses: number;
  /** Versión prudente (solo el resumen) para regenerar si salta el filtro. */
  conservative?: string;
}

function answerFromArticles(input: TurnInput, index: SearchIndex): Draft | null {
  const results = search(index, input.message, { limit: 3 });
  if (!results.length) return null;
  const reading = input.articleSlug ? results.find(result => result.slug === input.articleSlug) : undefined;
  const top = reading && reading.score >= results[0].score * 0.7 ? reading : results[0];
  const article = input.articles.find(item => item.slug === top.slug);
  if (!article || top.score < 2) return null;
  const sections = splitSections(article.body);
  const passage = bestPassage(sections, queryTerms(input.message));
  const section = passage?.section ?? sections.find(item => item.heading) ?? sections[0];
  const paragraphs = section ? section.paragraphs : [article.summary];
  const start = passage ? Math.max(0, paragraphs.indexOf(passage.paragraph)) : 0;
  const picked = paragraphs.length <= 4 ? paragraphs : paragraphs.slice(start, start + 3);
  const body = trimAnswer(picked.join('\n\n'));
  const sources: SourceRef[] = [{ slug: article.slug, title: article.title }];
  const second = results.find(result => result.slug !== article.slug && result.score >= top.score * 0.6);
  if (second) sources.push({ slug: second.slug, title: second.title });
  const closing = `Tienes todos los detalles en «${article.title}».`;
  return {
    text: `${body}\n\n${closing}`,
    sources,
    handoff: null,
    misses: 0,
    conservative: `${article.summary}\n\n${closing}`,
  };
}

function draftFor(intent: Intent, input: TurnInput, index: SearchIndex): Draft {
  const question = input.lastQuestion;
  const handoff = (reason: HandoffReason, collection?: string): Draft => ({
    text: HANDOFF_TEXT[reason],
    sources: [],
    handoff: handoffFor(reason, question, collection),
    misses: input.misses,
  });
  switch (intent) {
    case 'injection': return { text: INJECTION_ANSWER, sources: [], handoff: null, misses: input.misses };
    case 'identity': return { text: IDENTITY_ANSWER, sources: [], handoff: null, misses: input.misses };
    case 'greeting': return { text: GREETING_ANSWER, sources: [], handoff: null, misses: input.misses };
    case 'thanks': return { text: THANKS_ANSWER, sources: [], handoff: null, misses: input.misses };
    case 'human': return handoff('requested');
    case 'complaint': return handoff('complaint');
    case 'data_rights': {
      const draft = handoff('data_rights');
      const privacy = input.articles.find(article => article.slug === 'tus-derechos-de-privacidad');
      if (privacy) draft.sources = [{ slug: privacy.slug, title: privacy.title }];
      return draft;
    }
    case 'account_specific': {
      const found = answerFromArticles(input, index);
      const collection = found ? input.articles.find(article => article.slug === found.sources[0]?.slug)?.metadata.collection : 'plan-y-cuenta';
      const base = handoff('account_specific', collection);
      return found ? { ...base, text: `${HANDOFF_TEXT.account_specific}\n\n${found.text}`, sources: found.sources } : base;
    }
    case 'question':
    default: {
      const found = answerFromArticles(input, index);
      if (found) return found;
      const misses = input.misses + 1;
      if (misses >= 2) return { text: NO_MATCH_SECOND, sources: [], handoff: handoffFor('unresolved', input.message), misses };
      return { text: NO_MATCH_FIRST, sources: [], handoff: null, misses };
    }
  }
}

export interface ControlledOutput {
  text: string;
  filtered: boolean;
  block: FilterBlock | null;
  /** El control de salida pide derivar a una persona. */
  handoff: boolean;
}

/**
 * Control de salida: regenerar una vez (versión prudente); si vuelve a saltar, el
 * texto de respaldo; si el patrón no admite reformulación, respaldo y derivar.
 */
export function controlOutput(draft: string, conservative?: string): ControlledOutput {
  const first = checkOutput(draft);
  if (first.ok) return { text: draft, filtered: false, block: null, handoff: false };
  const block = first.block ?? null;
  if (!first.noRewrite && conservative && checkOutput(conservative).ok) return { text: conservative, filtered: true, block, handoff: false };
  return { text: SAFE_FALLBACK, filtered: true, block, handoff: true };
}

/** Responde a un mensaje de la persona. */
export function replyTo(input: TurnInput): TurnReply {
  const redaction = redactSensitive(input.message);
  const safeInput = { ...input, message: redaction.text, lastQuestion: input.lastQuestion ? redactSensitive(input.lastQuestion).text : undefined };
  const intent = detectIntent(redaction.text);
  const index = input.index ?? buildIndex(input.articles);
  const draft = draftFor(intent, safeInput, index);
  const output = controlOutput(draft.text, draft.conservative);
  const handoff = draft.handoff ?? (output.handoff ? handoffFor('unresolved', safeInput.lastQuestion ?? safeInput.message) : null);
  const text = redaction.kinds.length ? `${SENSITIVE_WARNING}\n\n${output.text}` : output.text;
  return {
    text,
    sources: output.text === SAFE_FALLBACK ? [] : draft.sources,
    handoff,
    redactedMessage: redaction.text,
    redacted: redaction.kinds.length > 0,
    filtered: output.filtered,
    filterBlock: output.block,
    misses: draft.misses,
    intent,
  };
}

/** Trocea una respuesta para enviarla poco a poco (2-4 palabras por evento). */
export function chunkText(text: string): string[] {
  const pieces = text.split(/(\s+)/);
  const chunks: string[] = [];
  let current = '';
  let count = 0;
  for (const piece of pieces) {
    current += piece;
    if (piece.trim()) count += 1;
    if (count >= 3 && /\s$/.test(current)) {
      chunks.push(current);
      current = '';
      count = 0;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
