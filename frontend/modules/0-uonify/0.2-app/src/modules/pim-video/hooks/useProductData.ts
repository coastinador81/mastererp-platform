import { useMemo } from 'react';
import { usePimSlice, useTabContext } from '@/shared/pim';
import { collectProductImages } from '../model/plan';
import type { ImageRef, ProductData } from '../model/types';

export interface ProductView {
  /** Textos de la ficha (lo que se está editando). */
  product: ProductData;
  /** SKU guardado (el que conoce el servidor). */
  savedSku: string;
  /** El SKU escrito aún no está guardado. */
  pendingSku: boolean;
  asin: string;
  /** Fotos de la ficha para el guion (galería + imagen del catálogo). */
  images: ImageRef[];
  isNew: boolean;
}

/**
 * Datos de la ficha que usa la pestaña «Vídeo» (prototipo: pim/video.js,
 * productData, savedSku, pendingSku, asin y productImages).
 */
export function useProductData(): ProductView {
  const ctx = useTabContext();
  // Las porciones se leen para volver a pintar cuando cambian.
  const [edited] = usePimSlice<Record<string, unknown>>('edited', {});
  const [uploads] = usePimSlice<unknown>('images', []);
  const [processed] = usePimSlice<unknown>('processedImages', []);
  const [generated] = usePimSlice<unknown>('aiImages', []);

  const product = useMemo<ProductData>(
    () => ({ ...(ctx.product ?? {}), ...(ctx.draft?.() ?? {}), ...edited }),
    [ctx, edited],
  );
  const images = useMemo(
    () => collectProductImages(product, { images: uploads, processedImages: processed, aiImages: generated }),
    [product, uploads, processed, generated],
  );
  const savedSku = String(ctx.product?.sku || '').trim();
  const typed = String(product.sku ?? '').trim();
  return {
    product,
    savedSku,
    pendingSku: Boolean(ctx.product && typed && typed !== savedSku),
    asin: String(product.asin || '').trim(),
    images,
    isNew: ctx.isNew,
  };
}
