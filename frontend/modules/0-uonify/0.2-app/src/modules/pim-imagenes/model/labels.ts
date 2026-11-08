import type { StyleConfig } from './types';

/**
 * Textos de la pestaña «Imágenes» (prototipo: pim/imagenes.js, «textos», y los
 * avisos de cada acción). Se conservan tal cual, emojis incluidos.
 */

export const STYLE_LABELS: Record<string, string> = {
  professional: 'Profesional',
  lifestyle: 'Lifestyle',
  minimalist: 'Minimalista',
  vintage: 'Vintage',
  modern: 'Moderno',
  artistic: 'Artístico',
};

export const styleLabel = (style: string): string => STYLE_LABELS[style] || style;

/** Insignia de la miniatura. */
export function sourceBadge(source: unknown): string {
  if (source === 'upload') return 'Subida';
  if (source === 'scrape') return 'Scrapeada';
  if (source === 'amazon') return 'Amazon';
  if (source === 'ai-generated') return 'IA';
  return 'Otro';
}

/** «Fuente» en la vista previa. */
export function sourceText(source: unknown): string {
  if (source === 'upload') return 'Upload';
  if (source === 'scrape') return 'Scraped';
  if (source === 'amazon') return 'Amazon';
  if (source === 'ai-generated') return 'AI Generated';
  return 'Otro';
}

export function sourceEmoji(source: unknown): string {
  if (source === 'upload') return '📁';
  if (source === 'scrape') return '🌐';
  if (source === 'amazon') return '📦';
  if (source === 'ai-generated') return '🤖';
  return '📄';
}

export type StatusTone = 'green' | 'purple' | 'red' | 'amber';

export interface StatusInfo {
  text: string;
  icon: string;
  badge: string;
  tone: StatusTone;
}

/** «Estado» en la vista previa. */
export function statusInfo(status: unknown): StatusInfo {
  if (status === 'processed') return { text: 'Procesado ✓', icon: 'check-circle-2', badge: '✅', tone: 'green' };
  if (status === 'generated') return { text: 'Generando...', icon: 'sparkles', badge: '🎨', tone: 'purple' };
  if (status === 'failed') return { text: 'Failed', icon: 'x-circle', badge: '❌', tone: 'red' };
  return { text: 'Listo', icon: 'clock', badge: '⏳', tone: 'amber' };
}

/**
 * Estilo con el que se generan las imágenes. La configuración de estilo y sus
 * plantillas se retiraron por decisión del dueño: se usa la predeterminada del original.
 */
export const DEFAULT_STYLE: StyleConfig = {
  style: 'professional',
  quality: 'high',
  aspectRatio: 'square',
  lighting: 'natural',
  background: 'white',
  mood: 'neutral',
};

/**
 * Avisos de la pestaña. El prototipo formaba el plural como «imagen» + «es»
 * («imagenes», sin tilde) y «1 imagen fallaron»; aquí se escriben bien.
 */
export const MESSAGES = {
  uploaded: (count: number) => `✅ ${count} imagen(es) subida(s) correctamente`,
  selectProduct: 'Selecciona un producto primero',
  scraped: (total: unknown) => `✅ ${String(total)} imágenes extraídas`,
  noImages: 'No se encontraron imágenes en la URL',
  error: (message: string) => `❌ Error: ${message}`,
  scrapeFallback: 'No se pudo extraer imágenes',
  generateFallback: 'No se pudieron generar las imágenes',
  deleted: (count: number) => `🗑️ ${count} ${count > 1 ? 'imágenes eliminadas' : 'imagen eliminada'}`,
  processedCleared: '🗑️ Imágenes procesadas eliminadas',
  resized: (count: number) => `✅ ${count} ${count > 1 ? 'imágenes redimensionadas' : 'imagen redimensionada'} a 1500px`,
  failed: (count: number) => `❌ ${count} ${count > 1 ? 'imágenes fallaron' : 'imagen falló'}`,
  processError: '❌ Error al procesar imágenes',
  generated: (count: number, style: string) => `🎨 ${count} imágenes generadas con estilo ${styleLabel(style)}`,
  downloaded: (name: string) => `📥 ${name} descargada`,
  downloadError: '❌ Error al descargar imagen',
} as const;
