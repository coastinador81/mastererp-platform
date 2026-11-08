/**
 * Texto y HTML de la pestaña Descripciones (prototipo: pim/descripciones.js;
 * original: DescriptionsTab.tsx y services/pim/aiDescriptionsService.ts).
 */

/** Filas de viñetas visibles (DescriptionsTab.tsx: seis posiciones). */
export const BULLET_ROWS = 6;

/** Un valor como texto ('' para null o undefined). */
export const cell = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));

/** Keywords como texto de la caja (una lista se une con comas). */
export const asKeywords = (value: unknown): string => (Array.isArray(value) ? value.map(cell).join(', ') : cell(value));

/** textToHtml (DescriptionsTab.tsx): el texto plano se enseña como párrafos; el HTML, tal cual. */
export function textToHtml(text: unknown): string {
  if (!text) return '';
  const value = cell(text);
  if (/<[a-z][\s\S]*>/i.test(value)) return value;
  return value
    .split('\n\n')
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** stripHtml, analizado de forma inerte: nada de lo que contiene se ejecuta. */
export function stripHtml(html: unknown): string {
  const doc = new DOMParser().parseFromString(cell(html), 'text/html');
  return doc.body.textContent || '';
}

/** extractSpecifications (aiDescriptionsService.ts): atributos útiles como «clave: valor». */
export function extractSpecifications(productData: Record<string, unknown> | null | undefined): string[] {
  const specs: string[] = [];
  const attrs = productData?._raw_attributes as Record<string, unknown> | undefined;
  if (attrs && typeof attrs === 'object') {
    const useful = ['brand', 'color', 'size', 'material', 'weight', 'dimensions', 'power', 'capacity', 'warranty', 'model_number'];
    useful.forEach(attr => {
      const raw = attrs[attr];
      if (!raw) return;
      const value = Array.isArray(raw) ? (raw[0] as { value?: unknown } | undefined)?.value : raw;
      if (value) specs.push(`${attr}: ${cell(value)}`);
    });
  }
  const attributes = productData?.attributes;
  if (attributes && typeof attributes === 'object') {
    Object.entries(attributes as Record<string, unknown>).forEach(([key, value]) => {
      if (value && typeof value === 'string') specs.push(`${key}: ${value}`);
    });
  }
  return specs;
}
