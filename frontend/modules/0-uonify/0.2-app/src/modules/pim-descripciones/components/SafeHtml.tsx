import { createElement, useMemo, type ReactNode } from 'react';
import { sanitizeHtml, type SafeNode } from '../model/safeHtml';

// Nombres de atributo de React para los pocos atributos que deja pasar la lista.
const ATTR_NAMES: Record<string, string> = { colspan: 'colSpan', rowspan: 'rowSpan', referrerpolicy: 'referrerPolicy' };

function toReact(nodes: SafeNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (typeof node === 'string') return node;
    const props: Record<string, unknown> = { key: index };
    Object.entries(node.attrs).forEach(([name, value]) => { props[ATTR_NAMES[name] ?? name] = value; });
    return node.children.length > 0 ? createElement(node.tag, props, ...toReact(node.children)) : createElement(node.tag, props);
  });
}

/** Pinta HTML del producto o de Uony ya saneado (sin dangerouslySetInnerHTML). */
export function SafeHtml({ html }: { html: string }) {
  const nodes = useMemo(() => sanitizeHtml(html), [html]);
  return <>{toReact(nodes)}</>;
}
