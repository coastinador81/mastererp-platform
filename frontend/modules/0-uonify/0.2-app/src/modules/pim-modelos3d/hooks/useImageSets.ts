import { useMemo } from 'react';
import { usePimValue, useTabContext } from '@/shared/pim';
import { computeImageSets, productImages, type ImageSets } from '../model/images';
import { staleBlobURLs } from '../model/pageState';

/**
 * processedImages y allImages de la pestaña Imágenes (useImageManager del
 * original): se actualizan si otra pestaña cambia la galería.
 */
export function useImageSets(): ImageSets {
  const ctx = useTabContext();
  const processedImages = usePimValue<unknown>(ctx.key, 'processedImages', null);
  const images = usePimValue<unknown>(ctx.key, 'images', null);
  const aiImages = usePimValue<unknown>(ctx.key, 'aiImages', null);
  const edited = usePimValue<unknown>(ctx.key, 'edited', null);
  const { key, product } = ctx;
  return useMemo(() => {
    const draftImages = (edited as { images?: unknown } | null)?.images ?? product?.images;
    return computeImageSets({ processedImages, images, aiImages, fallback: productImages(key, draftImages) }, staleBlobURLs);
  }, [processedImages, images, aiImages, edited, key, product]);
}
