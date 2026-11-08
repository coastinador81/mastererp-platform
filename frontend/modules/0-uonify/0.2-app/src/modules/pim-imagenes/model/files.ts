import type { Dimensions } from './types';

/**
 * Reglas puras de archivos e imágenes (prototipo: validateImageFile, el cálculo
 * del redimensionado a 1500 × 1500 y la navegación de la vista previa).
 */

export const VALID_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
export const ACCEPT_IMAGES = VALID_IMAGE_TYPES.join(',');

export type FileValidation = { isValid: true } | { isValid: false; error: string };

export function validateImageFile(file: Pick<File, 'type' | 'size'>): FileValidation {
  if (!VALID_IMAGE_TYPES.includes(file.type)) return { isValid: false, error: 'Formato no soportado. Use JPG, PNG o WEBP.' };
  if (file.size > MAX_IMAGE_SIZE) return { isValid: false, error: 'Archivo muy grande. Máximo 10MB.' };
  return { isValid: true };
}

/** Tamaño que pide Amazon para la galería. */
export const TARGET_SIZE = 1500;

export interface ContainRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** «contain» centrado dentro de un cuadrado de `size` px (fondo blanco alrededor). */
export function containRect(source: Dimensions, size = TARGET_SIZE): ContainRect {
  const scale = Math.min(size / source.width, size / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return { x: (size - width) / 2, y: (size - height) / 2, width, height };
}

/** Índice siguiente o anterior en la vista previa (da la vuelta en los extremos). */
export function navigateIndex(index: number, count: number, direction: 'prev' | 'next'): number {
  if (count <= 0) return index;
  if (direction === 'prev') return index > 0 ? index - 1 : count - 1;
  return index < count - 1 ? index + 1 : 0;
}

/** «(size / 1024).toFixed(0)KB» de la miniatura. */
export const kilobytes = (size: number): string => `${(size / 1024).toFixed(0)}KB`;

/** «Tamaño del archivo» de la vista previa. */
export const megabytes = (size: number): string => `${(size / 1024 / 1024).toFixed(2)} MB`;
