/**
 * Formato de datos para la interfaz (prototipo: pim/core.js, util.formatBytes).
 */

/** Tamaño legible: «512 B», «14.2 KB», «3.4 MB». Vacío si no es un número finito. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Escapa texto para meterlo en HTML (solo para puertos que construyen marcado a mano). */
export function escapeHTML(value: unknown = ''): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
  return String(value ?? '').replace(/[&<>'"]/g, char => map[char]);
}
