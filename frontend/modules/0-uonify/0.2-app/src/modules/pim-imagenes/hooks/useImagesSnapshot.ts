import { useMemo } from 'react';
import { usePimSlice, type PimProduct } from '@/shared/pim';
import { asArray, buildSnapshot, productInfoOf } from '../model/lists';
import type { ImagesSnapshot } from '../model/types';
import { isAlive } from '../state/memory';
import { useImagesMemory } from './useImagesMemory';

const NONE: string[] = [];

/**
 * Estado de la galería del producto de la pestaña: se repinta al cambiar sus
 * porciones del almacén, su selección o su catálogo de Amazon.
 */
export function useImagesSnapshot(key: string, product: PimProduct | null): ImagesSnapshot {
  const [images] = usePimSlice<unknown>('images', null);
  const [processedImages] = usePimSlice<unknown>('processedImages', null);
  const [aiImages] = usePimSlice<unknown>('aiImages', null);
  const [deletedImageUrls] = usePimSlice<unknown>('deletedImageUrls', null);
  const catalog = useImagesMemory(state => state.catalog[key]);
  const selection = useImagesMemory(state => state.selection[key]) ?? NONE;
  const info = useMemo(() => productInfoOf(product, key), [product, key]);
  return useMemo(
    () => buildSnapshot(
      { images, processedImages, aiImages },
      { info, catalog, deleted: new Set(asArray<string>(deletedImageUrls)), isAlive },
      selection,
    ),
    [images, processedImages, aiImages, deletedImageUrls, info, catalog, selection],
  );
}
