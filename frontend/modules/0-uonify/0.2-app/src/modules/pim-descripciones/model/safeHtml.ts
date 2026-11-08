import { cell } from './text';

/**
 * Vista previa segura del HTML (prototipo: renderSafeHtml, E04): se analiza de
 * forma inerte y se reconstruye con una lista de etiquetas y atributos
 * permitidos; el texto se copia como texto, así que nada del producto, de Uony
 * o del editor se ejecuta. Devuelve un árbol simple que pinta <SafeHtml/>.
 */
export type SafeNode = string | { tag: string; attrs: Record<string, string>; children: SafeNode[] };

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const ALLOWED_TAGS = new Set(['P', 'BR', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SMALL', 'SUP', 'SUB', 'MARK', 'CODE', 'PRE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'DIV', 'SECTION', 'ARTICLE', 'A', 'BLOCKQUOTE', 'HR', 'IMG', 'FIGURE', 'FIGCAPTION',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'DL', 'DT', 'DD']);
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'FORM', 'INPUT', 'BUTTON',
  'TEXTAREA', 'SELECT', 'OPTION', 'LINK', 'META', 'BASE', 'TEMPLATE', 'NOSCRIPT', 'AUDIO', 'VIDEO', 'SOURCE', 'TRACK', 'CANVAS', 'DIALOG', 'TITLE', 'HEAD']);
const VOID_TAGS = new Set(['BR', 'HR', 'IMG']);
// En una tabla, el texto en blanco entre filas no es contenido (React no lo admite ahí).
const TABLE_PARTS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR']);

function safeAttrs(element: Element, tag: string): Record<string, string> | null {
  const attrs: Record<string, string> = {};
  if (tag === 'A') {
    const href = (element.getAttribute('href') || '').trim();
    if (/^(https?:|mailto:)/i.test(href)) {
      attrs.href = href;
      const target = element.getAttribute('target');
      if (target) {
        attrs.target = target;
        attrs.rel = 'noopener noreferrer';
      }
    }
  } else if (tag === 'IMG') {
    const src = (element.getAttribute('src') || '').trim();
    if (!/^https?:/i.test(src)) return null;
    attrs.src = src;
    attrs.alt = element.getAttribute('alt') || '';
    attrs.loading = 'lazy';
    attrs.referrerpolicy = 'no-referrer';
  } else if (tag === 'TD' || tag === 'TH') {
    ['colspan', 'rowspan'].forEach(name => {
      const span = parseInt(element.getAttribute(name) || '', 10);
      if (span > 1 && span < 100) attrs[name] = String(span);
    });
  }
  return attrs;
}

function copy(from: Node, parentTag: string): SafeNode[] {
  const out: SafeNode[] = [];
  from.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? '';
      if (!(TABLE_PARTS.has(parentTag) && !text.trim())) out.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.namespaceURI !== HTML_NS) return;
    const tag = element.tagName.toUpperCase();
    if (DROPPED_TAGS.has(tag)) return;
    if (!ALLOWED_TAGS.has(tag)) {
      out.push(...copy(element, parentTag));
      return;
    }
    const attrs = safeAttrs(element, tag);
    if (!attrs) return;
    out.push({ tag: tag.toLowerCase(), attrs, children: VOID_TAGS.has(tag) ? [] : copy(element, tag) });
  });
  return out;
}

export function sanitizeHtml(html: unknown): SafeNode[] {
  const doc = new DOMParser().parseFromString(cell(html), 'text/html');
  return copy(doc.body, 'BODY');
}
