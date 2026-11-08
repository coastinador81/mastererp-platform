import { Fragment, type ReactNode } from 'react';

/**
 * Renderizador markdown mínimo para los textos legales (política de privacidad y
 * condiciones). Soporta exactamente lo que usan esos textos: títulos de nivel 2 y 3,
 * párrafos con **negrita** y enlaces (correos y URLs https), listas con un nivel de
 * anidación, tablas, citas (>) y separadores (---). El texto es la copia fiel de Legal;
 * este componente no lo reescribe.
 */

/** Convierte un título en un id estable para el ancla del índice. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export interface TocItem {
  id: string;
  label: string;
}

/** Títulos de nivel 2 (los apartados) para el índice de la página. */
export function tocFromMarkdown(md: string): TocItem[] {
  const items: TocItem[] = [];
  for (const line of md.split('\n')) {
    const m = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    if (m && m[1].length === 2) items.push({ id: slugify(m[2]), label: m[2] });
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

/** Renderiza texto en línea: **negrita**, *cursiva* y enlaces. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).forEach((part, i) => {
    if (!part) return;
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      nodes.push(<strong key={`b${i}`}>{linkify(part.slice(2, -2), `b${i}`)}</strong>);
    } else if (/^\*[^*]+\*$/.test(part)) {
      nodes.push(<em key={`i${i}`}>{linkify(part.slice(1, -1), `i${i}`)}</em>);
    } else {
      nodes.push(<Fragment key={`t${i}`}>{linkify(part, `t${i}`)}</Fragment>);
    }
  });
  return nodes;
}

function renderList(group: string[], key: number): ReactNode {
  const items: Array<{ text: string; children: string[] }> = [];
  for (const raw of group) {
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim().replace(/^[-*]\s+/, '');
    if (indent <= 1 || items.length === 0) items.push({ text, children: [] });
    else items[items.length - 1].children.push(text);
  }
  return (
    <ul key={key}>
      {items.map((it, idx) => (
        <li key={idx}>
          {renderInline(it.text)}
          {it.children.length > 0 && (
            <ul>
              {it.children.map((c, j) => (
                <li key={j}>{renderInline(c)}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
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
    <div className="legal-table-wrap" key={key}>
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

const SPECIAL = /^(#{2,6})\s|^>|^\||^\s*[-*]\s+|^---+\s*$/;

/** Renderiza un documento legal en markdown (ya con sus datos rellenados). */
export function LegalMarkdown({ source }: { source: string }): ReactNode {
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
    const heading = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const id = slugify(heading[2]);
      blocks.push(
        heading[1].length === 2 ? (
          <h2 id={id} key={key++}>
            {renderInline(heading[2])}
          </h2>
        ) : (
          <h3 id={id} key={key++}>
            {renderInline(heading[2])}
          </h3>
        ),
      );
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
    if (/^\s*[-*]\s+/.test(line)) {
      const group: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        group.push(lines[i]);
        i++;
      }
      blocks.push(renderList(group, key++));
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
