/**
 * Utilidades de texto de la pestaña «3D» (prototipo: pim/modelos3d.js, «utilidades»).
 */

/** Primera letra en mayúscula («front» → «Front»), como el original. */
export const cap = (text: unknown): string => String(text).charAt(0).toUpperCase() + String(text).slice(1);

/** Tamaño en MB con dos decimales («2.04 MB»). */
export const mb2 = (size: unknown): string => `${(Number(size) / 1024 / 1024).toFixed(2)} MB`;

export const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Nombre del archivo a partir de su key (último tramo de la ruta). */
export const fileNameOf = (key: unknown): string => String(key ?? '').split('/').pop() ?? '';

/**
 * Base64 de un texto en UTF-8 (E49: btoa fallaba con caracteres fuera de
 * Latin-1, p. ej. «Make It Possible · ñ»).
 */
export function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(String(text));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

/** AbortSignal que vence a los `ms` (si el navegador lo admite). */
export function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
  } catch {
    return undefined;
  }
}
