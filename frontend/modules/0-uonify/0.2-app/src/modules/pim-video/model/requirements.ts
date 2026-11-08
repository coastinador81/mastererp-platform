import { ADS_MAX_BYTES, LISTING_MAX_BYTES } from './constants';
import { destinationOf, formatLabel, formatSize, formatTime, languageLabel, near, ratioLabel } from './format';
import type { RequirementRow, VideoItem } from './types';

/**
 * Requisitos de Amazon para el destino del vídeo (prototipo: pim/video.js, requirements).
 * Ficha: guía de vídeos de Seller Central (España y EE. UU. iguales). Anuncio:
 * especificaciones de Sponsored Brands y de display con vídeo (lo que admiten los dos:
 * 1920 × 1080 o 3840 × 2160, 500 MB).
 */
export type RequirementInput = Pick<VideoItem, 'name' | 'type' | 'size'> & Partial<VideoItem>;

export function requirements(video: RequirementInput, asin = ''): RequirementRow[] {
  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  const known = width > 0 && height > 0;
  const duration = Number(video.duration) || 0;
  const format = formatLabel(video);
  const reading = video.unreadable ? 'No se pudo leer' : 'Leyendo…';
  const rows: RequirementRow[] = [{ id: 'format', label: 'Formato', need: 'MP4 o MOV', value: format, ok: format !== '—', required: true }];
  const durationRow = (need: string, ok: boolean): RequirementRow => ({
    id: 'duration', label: 'Duración', need, value: duration > 0 ? formatTime(duration) : reading, ok: duration > 0 && ok, required: true, text: !(duration > 0),
  });
  if (destinationOf(video) === 'ads') {
    rows.push(
      { id: 'size', label: 'Tamaño', need: 'Hasta 500 MB', value: formatSize(video.size), ok: video.size > 0 && video.size <= ADS_MAX_BYTES, required: true },
      { id: 'resolution', label: 'Resolución', need: '1920 × 1080 o 3840 × 2160', value: known ? `${width} × ${height}` : reading, ok: (width === 1920 && height === 1080) || (width === 3840 && height === 2160), required: true, text: !known },
      { id: 'ratio', label: 'Relación de aspecto', need: '16:9', value: ratioLabel(width, height), ok: near(width, height, 16 / 9), required: true },
      durationRow('De 6 a 45 s', duration >= 6 && duration <= 45),
      { id: 'display', label: 'Display', need: 'Hasta 15 s (norma de Amazon Ads)', value: duration > 15 ? 'Solo Sponsored Brands' : duration > 0 ? formatTime(duration) : '—', ok: duration > 0 && duration <= 15, required: false, text: duration > 15 },
    );
    return rows;
  }
  const title = String(video.title || '').trim();
  rows.push(
    { id: 'size', label: 'Tamaño', need: 'Hasta 5 GB', value: formatSize(video.size), ok: video.size > 0 && video.size <= LISTING_MAX_BYTES, required: true },
    { id: 'resolution', label: 'Resolución', need: 'Hasta 1080p · recomendado 1920 × 1080', value: known ? `${width} × ${height}` : reading, ok: known && Math.max(width, height) <= 1920 && Math.min(width, height) <= 1080, required: true, text: !known },
    { id: 'ratio', label: 'Relación de aspecto', need: '16:9 o 9:16', value: ratioLabel(width, height), ok: near(width, height, 16 / 9) || near(width, height, 9 / 16), required: false },
    durationRow('Hasta 12 min', duration <= 720),
    { id: 'title', label: 'Título', need: 'Obligatorio', value: title ? 'Añadido' : 'Falta', ok: Boolean(title), required: true, text: true, missing: true },
    { id: 'asin', label: 'ASIN', need: 'El producto, publicado en Amazon', value: asin || 'Falta', ok: Boolean(asin), required: true, text: !asin, missing: true },
    { id: 'language', label: 'Idioma', need: 'Obligatorio', value: languageLabel(video.language || 'es'), ok: true, required: true, text: true },
    { id: 'poster', label: 'Miniatura', need: 'Opcional: Amazon crea una', value: video.poster ? 'Añadida' : 'Automática', ok: Boolean(video.poster), required: false, text: true },
  );
  return rows;
}

/** Filas obligatorias que no se cumplen. */
export const missingRequirements = (rows: RequirementRow[]): RequirementRow[] => rows.filter(row => row.required && !row.ok);

/** «Revisa: resolución, ASIN.» (aviso cuando falta algo). */
export const missingSummary = (rows: RequirementRow[]): string =>
  `Revisa: ${rows.map(row => (row.id === 'asin' ? 'ASIN' : row.label.toLowerCase())).join(', ')}.`;

/** Estado accesible de una fila. */
export const rowState = (row: RequirementRow): string =>
  row.ok ? 'Cumple' : row.required ? (row.missing ? 'Falta' : 'No cumple') : 'Fuera de lo recomendado';
