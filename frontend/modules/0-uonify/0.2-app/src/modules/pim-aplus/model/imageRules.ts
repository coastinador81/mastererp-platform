import { ALLOWED_IMAGE_FORMATS, MAX_IMAGE_BYTES } from './constants';
import type { ImageDimensions } from './types';

/**
 * Normas de imagen de Amazon A+ (utils/aplusImageUpload.ts 31-70): formato,
 * peso y medidas mínimas, con los mensajes del original.
 */
export function imageFileErrors(format: string, size: number): string[] {
  const errors: string[] = [];
  if (!ALLOWED_IMAGE_FORMATS.includes(format)) errors.push('Formato no permitido. Use .jpg, .png o .bmp');
  if (size > MAX_IMAGE_BYTES) errors.push(`El archivo excede 2MB (actual: ${(size / 1024 / 1024).toFixed(1)}MB)`);
  return errors;
}

export function imageDimensionErrors(dimensions: ImageDimensions, minWidth: number, minHeight: number): string[] {
  if (dimensions.width < minWidth || dimensions.height < minHeight) {
    return [`Imagen muy pequeña. Mínimo: ${minWidth}x${minHeight}px (actual: ${dimensions.width}x${dimensions.height}px)`];
  }
  return [];
}

/** Tipo MIME a partir de la extensión de una URL (imágenes de la galería sin tipo). */
export function formatFromUrl(url: string): string {
  const match = /\.(jpe?g|png|bmp|webp|gif|avif)(?:[?#]|$)/i.exec(url);
  const ext = match?.[1]?.toLowerCase();
  if (!ext) return 'image/jpeg';
  return ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
}

/** Peso en MB con un decimal, como en la ficha de cada imagen («1.0MB»). */
export const formatMB = (size: number): string => `${((Number(size) || 0) / 1024 / 1024).toFixed(1)}MB`;
