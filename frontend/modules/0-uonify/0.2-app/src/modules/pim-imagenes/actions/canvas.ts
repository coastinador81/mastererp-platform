import { containRect, TARGET_SIZE } from '../model/files';
import { buildImageProxyUrl } from '../model/proxy';
import type { Dimensions } from '../model/types';

/**
 * Redimensionado en el navegador (prototipo: loadForCanvas y el lienzo de
 * processSelectedImages): 1500 × 1500 para Amazon, fondo blanco, «contain»
 * centrado, JPEG 0.95. Nada va al servidor salvo el reintento por el image-proxy.
 */

// Fondo que pide Amazon para la galería (píxeles del lienzo, no un color de la interfaz).
const AMAZON_WHITE = '#FFFFFF';
const JPEG_QUALITY = 0.95;

/** Carga directa y, si falla (CORS), un reintento por el image-proxy. */
export function loadForCanvas(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const imgElement = new Image();
    imgElement.crossOrigin = 'anonymous';
    let retried = false;
    imgElement.onload = () => resolve(imgElement);
    imgElement.onerror = error => {
      if (retried) {
        reject(error);
        return;
      }
      retried = true;
      imgElement.src = buildImageProxyUrl(url);
    };
    imgElement.src = url;
  });
}

export interface ResizedImage {
  blob: Blob;
  dimensions: Dimensions;
  originalDimensions: Dimensions;
}

export async function resizeForAmazon(url: string, size = TARGET_SIZE): Promise<ResizedImage> {
  const imgElement = await loadForCanvas(url);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo crear contexto canvas');
  canvas.width = size;
  canvas.height = size;
  context.fillStyle = AMAZON_WHITE;
  context.fillRect(0, 0, size, size);
  const original = { width: imgElement.width, height: imgElement.height };
  const rect = containRect(original, size);
  context.drawImage(imgElement, rect.x, rect.y, rect.width, rect.height);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('No se pudo generar la imagen');
  return { blob, dimensions: { width: canvas.width, height: canvas.height }, originalDimensions: original };
}
