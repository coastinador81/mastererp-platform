import type { PimProduct, PimScope } from '@/shared/pim';
import { productInfoOf } from '../model/lists';
import type { ImageItem } from '../model/types';
import { session, setSelection } from '../state/memory';
import { multiTenant, scrapedStorageKey } from '../state/multiTenant';
import { loadCatalogFor } from './catalog';
import { loadListsFor, saveListsFor } from './gallery';

/**
 * Montaje de la pestaña (prototipo: `mount` de PIM.register('imagenes')).
 * Recuerda el producto, limpia la selección al cambiar de producto, recupera las
 * scrapeadas guardadas, normaliza la porción 'images' y pide el catálogo de Amazon.
 */
export function mountImages(scope: PimScope, product: PimProduct | null): void {
  const key = scope.key;
  session.products.set(key, productInfoOf(product, key));
  if (session.lastKey !== key) {
    session.lastKey = key;
    setSelection(key, []);
    restoreScrapedFromStorage(scope, product);
  }
  saveListsFor(scope, loadListsFor(scope));
  loadCatalogFor(scope, product);
}

function restoreScrapedFromStorage(scope: PimScope, product: PimProduct | null): void {
  if (!product) return;
  let saved = multiTenant.getItem(scrapedStorageKey(scope.key));
  if (typeof saved === 'string') {
    try {
      saved = JSON.parse(saved) as unknown;
    } catch {
      saved = null;
    }
  }
  if (!Array.isArray(saved) || !saved.length) return;
  const lists = loadListsFor(scope);
  const known = new Set(lists.scraped.map(item => item.id));
  (saved as ImageItem[]).forEach(item => {
    if (item && item.url && !known.has(item.id)) {
      lists.scraped.push(item);
      known.add(item.id);
    }
  });
  saveListsFor(scope, lists);
}
