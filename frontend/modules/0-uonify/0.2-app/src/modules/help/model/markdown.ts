/**
 * Markdown de los artículos de ayuda (formato de Rentprivé): un subconjunto
 * pequeño y seguro. Bloques: `## ` y `### `, párrafos, listas (`- `, `1. `) y
 * notas (`> `). En línea: **negrita**, `código` y [enlaces](/ruta). Se convierte a
 * datos y la interfaz pinta React (nunca HTML crudo): admin puede editar sin riesgo.
 */
import { normalize } from './text';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string; external: boolean };

export type Block =
  | { kind: 'h2' | 'h3'; id: string; text: string }
  | { kind: 'p' | 'note'; content: Inline[] }
  | { kind: 'ul' | 'ol'; items: Inline[][] };

export interface Section {
  /** Título `##` (null para el texto antes del primer título). */
  heading: string | null;
  id: string | null;
  /** Texto plano de la sección (sin el título), para buscar y para Uony. */
  text: string;
  /** Párrafos y elementos de lista en texto plano, en orden. */
  paragraphs: string[];
}

/** Id de ancla estable a partir de un título («¿Cómo conecto Amazon?» → «como-conecto-amazon»). */
export function headingId(text: string): string {
  return normalize(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'seccion';
}

/** Solo se enlaza a rutas propias, https y correo; lo demás queda como texto. */
export function safeHref(href: string): { href: string; external: boolean } | null {
  const value = href.trim();
  if (/^\/(?!\/)/.test(value) || value.startsWith('#')) return { href: value, external: false };
  if (/^https:\/\/[^\s]+$/i.test(value)) return { href: value, external: true };
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)) return { href: value, external: false };
  return null;
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) });
    if (match[1] !== undefined) out.push({ kind: 'strong', text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: 'code', text: match[2] });
    else {
      const link = safeHref(match[4]);
      out.push(link ? { kind: 'link', text: match[3], ...link } : { kind: 'text', text: match[3] });
    }
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** Texto plano de una línea con formato en línea. */
export function inlineText(content: Inline[]): string {
  return content.map(part => part.text).join('');
}

const UL = /^\s*[-*]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const used = new Map<string, number>();
  const uniqueId = (text: string) => {
    const base = headingId(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  };
  let paragraph: string[] = [];
  let note: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: Inline[][] } | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'p', content: parseInline(paragraph.join(' ')) });
    if (note.length) blocks.push({ kind: 'note', content: parseInline(note.join(' ')) });
    if (list) blocks.push(list);
    paragraph = [];
    note = [];
    list = null;
  };
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flush();
      const text = heading[2].trim();
      blocks.push({ kind: heading[1].length === 2 ? 'h2' : 'h3', id: uniqueId(text), text });
      continue;
    }
    if (/^#\s+/.test(line.trim())) { flush(); continue; } // El título (#) va aparte, en el artículo.
    const ul = UL.exec(line);
    const ol = ul ? null : OL.exec(line);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (paragraph.length || note.length || (list && list.kind !== kind)) flush();
      list ??= { kind, items: [] };
      list.items.push(parseInline((ul ?? ol)![1].trim()));
      continue;
    }
    if (line.trim().startsWith('>')) {
      if (paragraph.length || list) flush();
      note.push(line.trim().replace(/^>\s?/, ''));
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) {
      // Continuación de un elemento de lista.
      const items = list.items;
      items[items.length - 1] = parseInline(`${inlineText(items[items.length - 1])} ${line.trim()}`);
      continue;
    }
    if (list || note.length) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

/** Divide el cuerpo en secciones por sus títulos `##` (las `###` quedan dentro). */
export function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { heading: null, id: null, text: '', paragraphs: [] };
  const push = () => {
    current.text = current.paragraphs.join(' ');
    if (current.heading || current.paragraphs.length) sections.push(current);
  };
  for (const block of parseMarkdown(markdown)) {
    if (block.kind === 'h2') {
      push();
      current = { heading: block.text, id: block.id, text: '', paragraphs: [] };
    } else if (block.kind === 'h3') current.paragraphs.push(block.text);
    else if (block.kind === 'ul' || block.kind === 'ol') block.items.forEach(item => current.paragraphs.push(inlineText(item)));
    else if ('content' in block) current.paragraphs.push(inlineText(block.content));
  }
  push();
  return sections;
}

/** Texto plano de todo el artículo (para buscar y calcular el tiempo de lectura). */
export function plainText(markdown: string): string {
  return splitSections(markdown)
    .map(section => [section.heading, section.text].filter(Boolean).join('. '))
    .join(' ');
}

/** Minutos de lectura a 200 palabras por minuto (mínimo 1). */
export function readingMinutes(markdown: string): number {
  const count = plainText(markdown).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(count / 200));
}
