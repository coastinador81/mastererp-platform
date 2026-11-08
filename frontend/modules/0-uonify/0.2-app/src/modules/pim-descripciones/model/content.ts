import type { PimEdited, PimProduct } from '@/shared/pim';
import { BULLET_ROWS, asKeywords, cell, textToHtml } from './text';

/**
 * Lo que enseña la pestaña a partir del producto guardado, la porción
 * `bullets` y la porción `edited` (prototipo: pim/descripciones.js;
 * DescriptionsTab.tsx: getLongDescription, getAmazonBulletPoints).
 */

type Raw = Record<string, unknown>;
const raw = (product: PimProduct | null): Raw => ((product?._raw_attributes && typeof product._raw_attributes === 'object') ? product._raw_attributes as Raw : {});
const firstValue = (list: unknown): unknown => (Array.isArray(list) ? (list[0] as { value?: unknown } | undefined)?.value : undefined);
const productBullets = (product: PimProduct | null): unknown => product?.bullets ?? product?.bullet_points;

/** Estado del hook: viñetas guardadas; si no, las del producto (resetData); si no, ['']. */
export function bulletState(stored: unknown, product: PimProduct | null): unknown[] {
  if (Array.isArray(stored)) return stored;
  const own = productBullets(product);
  return own ? (Array.isArray(own) ? own : []) : [''];
}

/** getAmazonBulletPoints: el estado; si está vacío, los bullet_point de Amazon o las del producto. */
export function displayBulletPoints(stored: unknown, product: PimProduct | null): unknown[] {
  const bulletPoints = bulletState(stored, product);
  if (bulletPoints.length > 0) return bulletPoints;
  const amazon = raw(product).bullet_point;
  if (amazon) return (Array.isArray(amazon) ? amazon : []).map(bp => (bp as { value?: unknown } | null)?.value || bp);
  const own = productBullets(product);
  if (Array.isArray(own) && own.length > 0) return own;
  return [];
}

/** Siempre seis filas de texto. */
export function bulletRows(stored: unknown, product: PimProduct | null): string[] {
  const display = displayBulletPoints(stored, product);
  return Array.from({ length: BULLET_ROWS }, (_, i) => cell(display[i]));
}

export function filledBullets(stored: unknown, product: PimProduct | null): number {
  return displayBulletPoints(stored, product).filter(bullet => cell(bullet).trim()).length;
}

/** handleBulletChange: las seis posiciones, leídas del estado actual. */
export function changeBullet(stored: unknown, product: PimProduct | null, index: number, value: string): string[] {
  const next = bulletRows(stored, product);
  next[index] = value;
  return next;
}

/** handleRemoveBullet: vacía la fila, no la quita, y no deja huecos (E11). */
export function clearBullet(stored: unknown, product: PimProduct | null, index: number): string[] {
  const display = displayBulletPoints(stored, product);
  const next = Array.from({ length: Math.max(display.length, index + 1) }, (_, i) => cell(display[i]));
  next[index] = '';
  return next;
}

/** Descripción del producto (atributo de Amazon o la suya). */
export function fallbackDescription(product: PimProduct | null): string {
  return cell(firstValue(raw(product).rtip_product_description) || product?.description || '');
}

/** Lo editado, incluso '', manda sobre lo del producto (E02/E05). */
export function editedDescription(edited: PimEdited): string | null {
  return typeof edited.description === 'string' ? edited.description : null;
}

export function previewHtml(edited: PimEdited, product: PimProduct | null): string {
  return textToHtml(editedDescription(edited) ?? fallbackDescription(product));
}

/** El editor HTML no reescribe lo que se teclea: lo editado va tal cual. */
export function codeValue(edited: PimEdited, product: PimProduct | null): string {
  return editedDescription(edited) ?? textToHtml(fallbackDescription(product));
}

export function keywordsValue(edited: PimEdited, product: PimProduct | null): string {
  return asKeywords(edited.keywords ?? firstValue(raw(product).generic_keyword) ?? product?.keywords ?? '');
}
