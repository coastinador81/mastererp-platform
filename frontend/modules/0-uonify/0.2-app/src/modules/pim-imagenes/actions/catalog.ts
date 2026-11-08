import type { PimProduct, PimScope } from '@/shared/pim';
import { getCatalogImages } from '../api/imagesApi';
import { asArray } from '../model/lists';
import type { CatalogImage } from '../model/types';
import { imagesMemory, session, setCatalog } from '../state/memory';
import { loadListsFor, saveListsFor } from './gallery';

/**
 * Imágenes del catálogo de Amazon (prototipo: loadCatalogFor y loadAmazonImages).
 * Son del producto: no se muestran las del anterior mientras carga y una respuesta
 * tardía de otro ASIN no sobrescribe (IMG-40).
 */

const refresh = (scope: PimScope): void => saveListsFor(scope, loadListsFor(scope));

export function loadCatalogFor(scope: PimScope, product: PimProduct | null): void {
  const key = scope.key;
  const asin = typeof product?.asin === 'string' ? product.asin : '';
  if (!product || product.source !== 'amazon' || !asin) {
    // clearAmazonImages
    if (key in imagesMemory.getState().catalog || session.catalogAsin.has(key)) {
      setCatalog(key, null);
      session.catalogAsin.delete(key);
      refresh(scope);
    }
    return;
  }
  if (session.catalogAsin.get(key) === asin) return;
  session.catalogAsin.set(key, asin);
  setCatalog(key, null);
  const fallback = typeof product.image === 'string' && product.image ? product.image : null;
  void loadAmazonImages(scope, key, asin, fallback);
}

async function loadAmazonImages(scope: PimScope, key: string, asin: string, fallbackImage: string | null): Promise<void> {
  let images: CatalogImage[];
  let failed = false;
  try {
    const catalogData = await getCatalogImages(asin);
    images = asArray<CatalogImage>(catalogData?.images);
  } catch (error) {
    failed = true;
    const message = String(error instanceof Error ? error.message : '');
    // Errores habituales (404 sin ASIN, 500 sin imágenes): sin imágenes y sin aviso.
    // Otros errores: la imagen principal del producto como reserva.
    if (message.includes('404') || message.includes('500')) images = [];
    else images = fallbackImage ? [{ variant: 'MAIN', link: fallbackImage, height: 500, width: 500 }] : [];
  }
  if (session.catalogAsin.get(key) !== asin) return;
  setCatalog(key, images);
  // Como el original al volver a seleccionar el producto: un fallo (no queda en la
  // caché) se vuelve a pedir en el siguiente montaje de ese producto.
  if (failed) session.catalogAsin.delete(key);
  refresh(scope);
}
