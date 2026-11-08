import { escapeHTML } from '@/shared/lib';

/**
 * Editor enriquecido del cuerpo (TextOverlayModule): el texto que se guarda es
 * texto plano con los saltos de línea del editor (A05/E27).
 */
const BLOCK = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE)$/;

/** Texto plano del editor conservando los saltos de línea. */
export function editorToPlainText(root: Node): string {
  let out = '';
  const walk = (node: Node) => {
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.nodeValue ?? '';
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      if (child.nodeName === 'BR') {
        out += '\n';
        return;
      }
      const block = BLOCK.test(child.nodeName);
      if (block && out && !out.endsWith('\n')) out += '\n';
      walk(child);
      if (block && !out.endsWith('\n')) out += '\n';
    });
  };
  walk(root);
  return out.replace(/\u00a0/g, ' ').replace(/\n$/, '');
}

/** TextOverlayModule.tsx 406-411: texto → HTML del editor, con escape. */
export function formatBodyTextForEditor(text: string): string {
  if (!text) return '';
  return escapeHTML(text).replace(/\n/g, '<br>');
}
