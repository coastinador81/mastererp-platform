/**
 * Búsqueda en los artículos de ayuda: en español, sin tildes, tolerante a erratas
 * y con sinónimos. Devuelve un fragmento con las coincidencias marcadas. La usan
 * el servidor simulado (GET /help/search) y Uony de soporte para elegir fuentes.
 */
import { splitSections, type Section } from './markdown';
import { allowedTypos, editDistance, normalize, synonymsOf, tokenize, words } from './text';
import type { SearchResult, SnippetPart } from './types';

export interface SearchableArticle {
  slug: string;
  title: string;
  summary: string;
  body: string;
  keywords: string[];
  metadata: { collection: string };
}

interface IndexedArticle {
  article: SearchableArticle;
  fields: Array<{ weight: number; words: Set<string> }>;
  sections: Section[];
}

export interface SearchIndex {
  articles: IndexedArticle[];
}

const WEIGHTS = { title: 6, keywords: 5, headings: 3, summary: 2, body: 1 } as const;

export function buildIndex(articles: SearchableArticle[]): SearchIndex {
  return {
    articles: articles.map(article => {
      const sections = splitSections(article.body);
      const headings = sections.map(section => section.heading ?? '').join(' ');
      return {
        article,
        sections,
        fields: [
          { weight: WEIGHTS.title, words: new Set(tokenize(article.title)) },
          { weight: WEIGHTS.keywords, words: new Set(tokenize(article.keywords.join(' '))) },
          { weight: WEIGHTS.headings, words: new Set(tokenize(headings)) },
          { weight: WEIGHTS.summary, words: new Set(tokenize(article.summary)) },
          { weight: WEIGHTS.body, words: new Set(tokenize(sections.map(section => section.text).join(' '))) },
        ],
      };
    }),
  };
}

/** Calidad de la coincidencia de una palabra con lo buscado: 1 exacta, 0,75 prefijo, 0,55 errata. */
export function matchQuality(word: string, token: string): number {
  if (word === token) return 1;
  if (token.length >= 3 && word.startsWith(token)) return 0.75;
  if (token.length >= 4 && token.startsWith(word) && word.length >= token.length - 2 && word.length >= 4) return 0.7;
  const typos = allowedTypos(token);
  if (typos && Math.abs(word.length - token.length) <= typos && editDistance(word, token, typos) <= typos) return 0.55;
  return 0;
}

function bestIn(set: Set<string>, token: string): number {
  if (set.has(token)) return 1;
  let best = 0;
  for (const word of set) {
    const quality = matchQuality(word, token);
    if (quality > best) best = quality;
    if (best >= 0.75) break;
  }
  return best;
}

interface QueryTerm {
  token: string;
  alternatives: string[];
}

/** Palabras de la consulta con sus sinónimos. */
export function queryTerms(query: string): QueryTerm[] {
  const seen = new Set<string>();
  return tokenize(query)
    .filter(token => (seen.has(token) ? false : (seen.add(token), true)))
    .map(token => ({ token, alternatives: synonymsOf(token) }));
}

function termScore(entry: IndexedArticle, term: QueryTerm): number {
  let total = 0;
  for (const field of entry.fields) {
    const direct = bestIn(field.words, term.token);
    const synonym = term.alternatives.reduce((best, alt) => Math.max(best, bestIn(field.words, alt) * 0.6), 0);
    total += field.weight * Math.max(direct, synonym);
  }
  return total;
}

/** Marca en un texto las palabras que coinciden con la consulta. */
export function highlight(text: string, terms: QueryTerm[]): SnippetPart[] {
  const tokens = terms.flatMap(term => [term.token, ...term.alternatives]);
  const parts: SnippetPart[] = [];
  const push = (value: string, match: boolean) => {
    if (!value) return;
    const last = parts[parts.length - 1];
    if (last && last.match === match) last.text += value;
    else parts.push({ text: value, match });
  };
  for (const piece of text.split(/([\p{L}\p{N}]+)/u)) {
    const word = normalize(piece);
    const isWord = /^[a-z0-9]+$/.test(word);
    push(piece, isWord && word.length > 1 && tokens.some(token => matchQuality(word, token) > 0));
  }
  return parts;
}

const SNIPPET_LENGTH = 180;

/** Recorta un párrafo alrededor de la primera coincidencia. */
function around(text: string, terms: QueryTerm[]): string {
  if (text.length <= SNIPPET_LENGTH) return text;
  const tokens = terms.flatMap(term => [term.token, ...term.alternatives]);
  const list = text.split(/(\s+)/);
  let offset = 0;
  let hit = -1;
  for (const piece of list) {
    const word = words(piece)[0];
    if (word && tokens.some(token => matchQuality(word, token) > 0)) { hit = offset; break; }
    offset += piece.length;
  }
  const start = hit < 60 ? 0 : text.lastIndexOf(' ', hit - 50) + 1;
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const cut = text.slice(start, end);
  const tidy = end < text.length ? cut.slice(0, cut.lastIndexOf(' ')) : cut;
  return `${start > 0 ? '…' : ''}${tidy}${end < text.length ? '…' : ''}`;
}

/** Sección y párrafo que mejor responden a la consulta (también lo usa Uony). */
export function bestPassage(sections: Section[], terms: QueryTerm[]): { section: Section; paragraph: string; score: number } | null {
  let best: { section: Section; paragraph: string; score: number } | null = null;
  for (const section of sections) {
    const headingWords = new Set(tokenize(section.heading ?? ''));
    for (const paragraph of section.paragraphs.length ? section.paragraphs : ['']) {
      const paragraphWords = new Set(tokenize(paragraph));
      const score = terms.reduce((sum, term) => {
        const options = [term.token, ...term.alternatives];
        const inHeading = Math.max(...options.map(option => bestIn(headingWords, option)));
        const inText = Math.max(...options.map(option => bestIn(paragraphWords, option)));
        return sum + inHeading * 2 + inText;
      }, 0);
      if (score > 0 && (!best || score > best.score)) best = { section, paragraph, score };
    }
  }
  return best;
}

export interface SearchOptions {
  limit?: number;
}

export function search(index: SearchIndex, query: string, { limit = 10 }: SearchOptions = {}): SearchResult[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const scored = index.articles.map(entry => {
    const perTerm = terms.map(term => termScore(entry, term));
    return { entry, perTerm, total: perTerm.reduce((sum, value) => sum + value, 0), matched: perTerm.filter(value => value > 0).length };
  });
  // Primero, los que contienen todas las palabras; si no hay, los que contienen alguna.
  const all = scored.filter(item => item.matched === terms.length);
  const pool = all.length ? all : scored.filter(item => item.matched > 0);
  return pool
    .sort((a, b) => b.matched - a.matched || b.total - a.total || a.entry.article.title.localeCompare(b.entry.article.title, 'es'))
    .slice(0, limit)
    .map(({ entry, total }) => {
      const passage = bestPassage(entry.sections, terms);
      const source = passage?.paragraph ? around(passage.paragraph, terms) : entry.article.summary;
      return {
        slug: entry.article.slug,
        title: entry.article.title,
        summary: entry.article.summary,
        collection: entry.article.metadata.collection,
        score: Math.round(total * 100) / 100,
        section: passage?.section.heading ?? null,
        snippet: highlight(source, terms),
      };
    });
}
