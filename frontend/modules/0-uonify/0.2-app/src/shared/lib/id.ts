/**
 * Identificadores y números (prototipo: pim/core.js, util.uid y util.clamp).
 */

/** Identificador único legible: «toast-lx3k9a-4f8e2c». */
export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Limita `value` al intervalo [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
