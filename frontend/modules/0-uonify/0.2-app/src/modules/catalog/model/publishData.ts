import type { PublishData } from '@/shared/pim';
import type { CatalogProduct } from './types';

/** Lectura de una porción del almacén del PIM: (clave, porción) → valor. */
export type SliceReader = (key: string, slice: string) => unknown;

type ImageLike = string | { url?: string } | null | undefined;

const MAX_IMAGES = 10;

/**
 * Lo que se publica (prototipo: publishData de app-shell.js): el producto guardado
 * más el trabajo de las pestañas (ediciones, viñetas, campos personalizados,
 * galería y GPSR del almacén del PIM). El SKU es siempre el guardado: un SKU escrito
 * pero sin guardar bloquea el producto hasta guardarlo (podría ser de otro
 * producto). Imágenes como las envía «Guardar Cambios»: la galería tal cual (una
 * galería vaciada sigue vacía), sin repetidas y diez como máximo.
 */
export function publishData(product: CatalogProduct, read: SliceReader): PublishData {
  const key = product.sku;
  const edited = (read(key, 'edited') as Record<string, unknown> | undefined) || {};
  const bullets = read(key, 'bullets');
  const gallery = read(key, 'images');
  const source: ImageLike[] = Array.isArray(gallery)
    ? gallery
    : Array.isArray(product.images)
      ? (product.images as ImageLike[])
      : product.image
        ? [product.image]
        : [];
  const images = source
    .map(image => (typeof image === 'string' ? image : image?.url))
    .filter((url, index, list): url is string => Boolean(url) && list.indexOf(url) === index)
    .slice(0, MAX_IMAGES);
  const typedSku = String(edited.sku ?? '').trim();
  const bulletList = Array.isArray(bullets) ? bullets : Array.isArray(product.bullets) ? (product.bullets as unknown[]) : [];
  return {
    ...product,
    ...edited,
    sku: product.sku,
    pendingSku: typedSku && typedSku !== product.sku ? typedSku : '',
    bullet_points: bulletList.filter(bullet => String(bullet ?? '').trim()).map(String),
    images,
    customFields: (read(key, 'customFields') as unknown[] | undefined) || (product.customFields as unknown[] | undefined) || [],
    gpsr: (read(key, 'gpsr') as Record<string, unknown> | undefined) || (product.gpsr as Record<string, unknown> | undefined) || null,
  };
}
