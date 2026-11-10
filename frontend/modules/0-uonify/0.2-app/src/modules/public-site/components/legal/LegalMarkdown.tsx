import { createElement, Fragment, type ReactNode } from 'react';

/**
 * Renderizador markdown mínimo para los textos legales (política de privacidad y
 * condiciones). Soporta exactamente lo que usan esos textos: títulos (con su nivel
 * desplazable para encajar bajo el título del panel), párrafos con **negrita**,
 * *cursiva*, `código`, saltos <br> y enlaces (correos y URLs https), listas con y sin
 * número y varios niveles de anidación, tablas, citas (>) y separadores (---). El texto
 * es la copia fiel de Legal; este componente no lo reescribe.
 */

/** Convierte un título en un id estable para el ancla del índice. Con `prefix`,
 *  el id se namespacea por panel (evita colisiones entre documentos de una misma página). */
export function slugify(text: string, prefix?: string): string {
  const base = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return prefix ? `${prefix}-${base}` : base;
}

export interface TocItem {
  id: string;
  label: string;
}

/** Títulos de nivel 2 (los apartados) para el índice de la página o del panel. */
export function tocFromMarkdown(md: string, prefix?: string): TocItem[] {
  const items: TocItem[] = [];
  for (const line of md.split('\n')) {
    const m = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    // La etiqueta se muestra limpia (sin marcas de `código` ni *énfasis*); el id no cambia.
    if (m && m[1].length === 2) items.push({ id: slugify(m[2], prefix), label: m[2].replace(/[`*]/g, '') });
  }
  return items;
}

/** Enlaza correos y URLs https dentro de un fragmento de texto. */
function linkify(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(https?:\/\/[^\s)]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      const trail = /[.,;:]+$/.exec(m[1]);
      const url = trail ? m[1].slice(0, -trail[0].length) : m[1];
      out.push(
        <a key={`${keyBase}-l${i}`} href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>,
      );
      if (trail) out.push(trail[0]);
    } else {
      out.push(
        <a key={`${keyBase}-m${i}`} href={`mailto:${m[2]}`}>
          {m[2]}
        </a>,
      );
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Elementos «hoja» de una línea: `código`, saltos <br> y enlaces (sin negrita ni
 *  cursiva), para poder anidarlos también dentro de **negrita** y *cursiva*. */
function renderSpans(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  text.split(/(`[^`]+`|<br\s*\/?>)/gi).forEach((part, i) => {
    if (!part) return;
    if (/^`[^`]+`$/.test(part)) nodes.push(<code key={`${keyBase}c${i}`}>{part.slice(1, -1)}</code>);
    else if (/^<br\s*\/?>$/i.test(part)) nodes.push(<br key={`${keyBase}br${i}`} />);
    else nodes.push(<Fragment key={`${keyBase}t${i}`}>{linkify(part, `${keyBase}l${i}`)}</Fragment>);
  });
  return nodes;
}

/** Renderiza texto en línea: **negrita**, *cursiva*, `código`, saltos <br> y enlaces. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).forEach((part, i) => {
    if (!part) return;
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      nodes.push(<strong key={`b${i}`}>{renderSpans(part.slice(2, -2), `b${i}`)}</strong>);
    } else if (/^\*[^*]+\*$/.test(part)) {
      nodes.push(<em key={`i${i}`}>{renderSpans(part.slice(1, -1), `i${i}`)}</em>);
    } else {
      nodes.push(...renderSpans(part, `t${i}`));
    }
  });
  return nodes;
}

interface ListNode {
  ordered: boolean;
  items: Array<{ text: string; child?: ListNode }>;
}

/** Marca de lista: viñeta (-, *) o número (1., 2., …). */
const LIST_ITEM = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/;

/** Construye el árbol de una lista por indentación (ordenadas, sin orden y anidadas). */
function parseList(group: string[]): ListNode {
  const entries = group.map(raw => {
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    const ordered = /^\d+\.\s+/.test(trimmed);
    return { indent, ordered, text: trimmed.replace(/^(?:[-*]|\d+\.)\s+/, '') };
  });
  const root: ListNode = { ordered: entries[0].ordered, items: [] };
  const stack: Array<{ list: ListNode; indent: number }> = [{ list: root, indent: entries[0].indent }];
  for (const entry of entries) {
    while (stack.length > 1 && entry.indent < stack[stack.length - 1].indent) stack.pop();
    let top = stack[stack.length - 1];
    if (entry.indent > top.indent) {
      const parent = top.list.items[top.list.items.length - 1];
      if (parent) {
        parent.child = { ordered: entry.ordered, items: [] };
        stack.push({ list: parent.child, indent: entry.indent });
        top = stack[stack.length - 1];
      }
    }
    top.list.items.push({ text: entry.text });
  }
  return root;
}

function renderList(node: ListNode, key: number): ReactNode {
  return createElement(
    node.ordered ? 'ol' : 'ul',
    { key },
    node.items.map((it, idx) => (
      <li key={idx}>
        {renderInline(it.text)}
        {it.child && renderList(it.child, idx)}
      </li>
    )),
  );
}

function renderTable(rows: string[], key: number): ReactNode {
  const cells = (r: string) =>
    r
      .replace(/^\||\|$/g, '')
      .split('|')
      .map(c => c.trim());
  const header = cells(rows[0]);
  const body = rows.slice(1).filter(r => !/^\|?[\s:|-]+\|?$/.test(r));
  return (
    <div className="legal-table-wrap" key={key} tabIndex={0} role="group" aria-label="Tabla (desplázala en horizontal)">
      <table className="legal-table">
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i}>{renderInline(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {cells(r).map((c, j) => (
                <td key={j}>{renderInline(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SPECIAL = /^(#{2,6})\s|^>|^\||^\s*(?:[-*]|\d+\.)\s+|^---+\s*$|^```/;

/** Renderiza un documento legal en markdown (ya con sus datos rellenados).
 *  `idPrefix` namespacea las anclas de los títulos cuando varios documentos conviven
 *  en una misma página (centro legal con pestañas). `headingOffset` baja el nivel de los
 *  títulos (p. ej. 1 para que `##` sea `<h3>` bajo el `<h2>` del panel). */
export function LegalMarkdown(
  { source, idPrefix, headingOffset = 0 }: { source: string; idPrefix?: string; headingOffset?: number },
): ReactNode {
  const lines = source.split('\n').filter(l => !/^#\s/.test(l));
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) i++; // salta el cierre ```
      blocks.push(<pre className="legal-pre" key={key++}><code>{buf.join('\n')}</code></pre>);
      continue;
    }
    const heading = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const id = slugify(heading[2], idPrefix);
      const level = Math.min(6, heading[1].length + headingOffset);
      blocks.push(createElement(`h${level}`, { id, key: key++ }, renderInline(heading[2])));
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      blocks.push(<hr className="legal-rule" key={key++} />);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(<blockquote key={key++}>{renderInline(buf.join(' '))}</blockquote>);
      continue;
    }
    if (/^\|/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      blocks.push(renderTable(rows, key++));
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const group: string[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        group.push(lines[i]);
        i++;
      }
      blocks.push(renderList(parseList(group), key++));
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !SPECIAL.test(lines[i])) {
      const raw = lines[i];
      buf.push(raw.trim());
      i++;
      if (/\s{2,}$/.test(raw)) break;
    }
    blocks.push(<p key={key++}>{renderInline(buf.join(' '))}</p>);
  }
  return <>{blocks}</>;
}
