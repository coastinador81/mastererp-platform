/**
 * Reglas de los artículos que crea o edita admin (POST/PUT /help/articles).
 */
import { normalize } from './text';
import type { ArticleStatus, HelpArticle, HelpArticleInput, HelpArticleSummary } from './types';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TITLE_MAX = 120;
export const SUMMARY_MAX = 280;
export const BODY_MAX = 40_000;

/** Slug a partir de un título («¿Cómo conecto Amazon?» → «como-conecto-amazon»). */
export function slugify(text: string): string {
  return normalize(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/** Palabras marcadas por el control de salida: un artículo nunca publica marcadores internos. */
const INTERNAL_MARKERS = /\b(PENDIENTE|BORRADOR|LOREM IPSUM|TODO|TBD|XXX)\b/;

export type ArticleValidation = { ok: true; value: HelpArticleInput } | { ok: false; message: string };

const strings = (value: unknown, max: number): string[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return null;
  return (value as string[]).map(item => item.trim()).filter(Boolean).slice(0, max);
};

/** Comprueba lo que envía admin. `collections` son los ids válidos. */
export function validateArticleInput(input: unknown, collections: string[]): ArticleValidation {
  if (!input || typeof input !== 'object') return { ok: false, message: 'El artículo no es válido.' };
  const body = input as Record<string, unknown>;
  const text = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '');
  const title = text('title');
  const slug = text('slug') || slugify(title);
  const summary = text('summary');
  const markdown = text('body');
  const collection = text('collection');
  if (!title) return { ok: false, message: 'Escribe un título.' };
  if (title.length > TITLE_MAX) return { ok: false, message: `El título admite como máximo ${TITLE_MAX} caracteres.` };
  if (!SLUG_PATTERN.test(slug)) return { ok: false, message: 'El slug solo admite minúsculas, números y guiones.' };
  if (!summary) return { ok: false, message: 'Escribe un resumen.' };
  if (summary.length > SUMMARY_MAX) return { ok: false, message: `El resumen admite como máximo ${SUMMARY_MAX} caracteres.` };
  if (!markdown) return { ok: false, message: 'El artículo no tiene contenido.' };
  if (markdown.length > BODY_MAX) return { ok: false, message: 'El artículo es demasiado largo.' };
  if (!collections.includes(collection)) return { ok: false, message: 'Elige una colección que exista.' };
  const status = body.status ?? 'draft';
  if (status !== 'published' && status !== 'draft') return { ok: false, message: 'El estado debe ser «published» o «draft».' };
  if (status === 'published' && INTERNAL_MARKERS.test(`${title} ${summary} ${markdown}`)) {
    return { ok: false, message: 'El artículo contiene marcas internas (por ejemplo, «PENDIENTE»). Quítalas antes de publicar.' };
  }
  const plan = body.plan ?? 'all';
  if (plan !== 'all' && plan !== 'paid' && plan !== 'free') return { ok: false, message: 'El plan debe ser «all», «paid» o «free».' };
  const keywords = strings(body.keywords, 30);
  const assistantNotes = strings(body.assistantNotes, 20);
  if (!keywords || !assistantNotes) return { ok: false, message: 'Las palabras clave y las notas para Uony deben ser listas de textos.' };
  const order = body.order === undefined ? undefined : Number(body.order);
  if (order !== undefined && !Number.isInteger(order)) return { ok: false, message: 'El orden debe ser un número entero.' };
  return {
    ok: true,
    value: { slug, title, summary, body: markdown, collection, keywords, assistantNotes, plan, status: status as ArticleStatus, topic: text('topic') || collection, order },
  };
}

/** Artículo sin cuerpo ni notas internas, para listados. */
export function toSummary(article: HelpArticle): HelpArticleSummary {
  const { body: _body, assistantNotes: _notes, ...summary } = article;
  return summary;
}

export function isPublished(article: Pick<HelpArticle, 'metadata'>): boolean {
  return article.metadata.status === 'published';
}

/** Orden de lectura: colección y después su orden dentro de ella. */
export function sortArticles<T extends Pick<HelpArticle, 'order' | 'title' | 'metadata'>>(articles: T[], collectionOrder: string[]): T[] {
  const rank = (id: string) => {
    const index = collectionOrder.indexOf(id);
    return index < 0 ? collectionOrder.length : index;
  };
  return [...articles].sort((a, b) => rank(a.metadata.collection) - rank(b.metadata.collection) || a.order - b.order || a.title.localeCompare(b.title, 'es'));
}
