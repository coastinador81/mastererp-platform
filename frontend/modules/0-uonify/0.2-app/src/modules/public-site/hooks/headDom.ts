import { HEAD_ATTR, type HeadTag } from '../model/seo/head';

function managed(head: HTMLHeadElement): Element[] {
  return Array.from(head.querySelectorAll(`[${HEAD_ATTR}]`));
}

function syncElement(element: Element, tag: HeadTag): void {
  for (const attr of Array.from(element.attributes)) {
    if (attr.name !== HEAD_ATTR && !Object.hasOwn(tag.attrs, attr.name)) element.removeAttribute(attr.name);
  }
  for (const [name, value] of Object.entries(tag.attrs)) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  element.setAttribute(HEAD_ATTR, tag.key);
  if (tag.text !== undefined && element.textContent !== tag.text) element.textContent = tag.text;
}

/**
 * Aplica unas etiquetas al <head>: actualiza las que ya existen por su clave (también
 * las de index.html y las del prerender), crea las que faltan y quita las gestionadas
 * que ya no tocan. El título va por document.title.
 */
export function applyHead(tags: readonly HeadTag[], doc: Document = document): void {
  const head = doc.head;
  const existing = new Map(managed(head).map(element => [element.getAttribute(HEAD_ATTR) ?? '', element]));
  const keep = new Set<string>();
  for (const tag of tags) {
    if (tag.name === 'title') {
      if (doc.title !== tag.text) doc.title = tag.text ?? '';
      continue;
    }
    keep.add(tag.key);
    let element = existing.get(tag.key);
    if (!element || element.tagName.toLowerCase() !== tag.name) {
      element?.remove();
      element = doc.createElement(tag.name);
      head.append(element);
    }
    syncElement(element, tag);
  }
  for (const element of managed(head)) {
    if (!keep.has(element.getAttribute(HEAD_ATTR) ?? '')) element.remove();
  }
}
