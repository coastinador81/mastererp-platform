import { asArray } from './format';
import type { ImageSource, SourceImage } from './types';

/**
 * Imágenes con las que se genera un modelo (prototipo: productImages e
 * imageSets de pim/modelos3d.js, useImageManager del original).
 */

/** Imágenes del producto guardado (Amazon / Shopify) cuando la galería aún no existe. */
export function productImages(productKey: string, images: unknown): SourceImage[] {
  return asArray<unknown>(images)
    .map((entry, index) => ({
      id: `product-${productKey}-${index}`,
      url: typeof entry === 'string' ? entry : String((entry as { url?: unknown } | null)?.url ?? ''),
      name: `Product Image ${index + 1}`,
      source: 'amazon',
      status: 'ready',
    }))
    .filter(image => !!image.url);
}

export interface ImageSets {
  processed: SourceImage[];
  all: SourceImage[];
}

export interface ImageSlices {
  processedImages: unknown;
  /** Porción `images` de la pestaña Imágenes (null si nunca se abrió). */
  images: unknown;
  aiImages: unknown;
  /** Imágenes del producto, para cuando no hay galería. */
  fallback: SourceImage[];
}

const hasUrl = (image: unknown): image is SourceImage => !!image && typeof (image as SourceImage).url === 'string' && !!(image as SourceImage).url;

/**
 * processedImages y allImages. Como Imágenes: las blob: URLs de una carga
 * anterior de la página no cuentan (E29).
 */
export function computeImageSets({ processedImages, images, aiImages, fallback }: ImageSlices, stale: Set<string>): ImageSets {
  const alive = (image: SourceImage) => !String(image.url).startsWith('blob:') || !stale.has(image.url);
  const processed = asArray<unknown>(processedImages).filter(hasUrl).filter(alive);
  const gallery = (Array.isArray(images) ? images.filter(hasUrl) : fallback).filter(alive);
  const ai = asArray<unknown>(aiImages).filter(hasUrl).filter(alive);
  const seen = new Set<string>();
  const all = [...gallery, ...ai, ...processed].filter(image => {
    const id = String(image.id ?? image.url);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { processed, all };
}

/** Las imágenes que usará la generación: las procesadas si las hay, si no, todas. */
export const galleryImages = ({ processed, all }: ImageSets): SourceImage[] => (processed.length > 0 ? processed : all);

/** «Generar Modelo 3D» del estado vacío: apagado si la fuente elegida no tiene imágenes. */
export function generateDisabled(source: ImageSource, sets: ImageSets, customCount: number): boolean {
  return source === 'gallery' ? sets.processed.length === 0 && sets.all.length === 0 : customCount === 0;
}

export type SourceMessage =
  | { tone: 'warning'; text: string }
  | { tone: 'success'; text: string }
  | null;

/** Aviso bajo «Fuente de Imágenes». */
export function sourceMessage(source: ImageSource, sets: ImageSets, customCount: number): SourceMessage {
  const { processed, all } = sets;
  if (source === 'gallery' && processed.length === 0 && all.length === 0) return { tone: 'warning', text: 'Agrega imágenes en la pestaña "Imágenes"' };
  if (source === 'gallery' && processed.length > 0) return { tone: 'success', text: `Usando ${processed.length} procesada${processed.length > 1 ? 's' : ''}` };
  if (source === 'upload' && customCount === 0) return { tone: 'warning', text: 'Selecciona imágenes para generar el modelo' };
  return null;
}
