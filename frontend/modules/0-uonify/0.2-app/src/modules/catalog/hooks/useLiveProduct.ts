import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { USE_MOCKS } from '@/shared/api/config';
import { hasProductEdits, pimStore, setActiveProduct, type ProductChange } from '@/shared/pim';
import type { CatalogProduct } from '../model/types';
import { catalogKeys, getCachedProducts, setCachedProducts } from '../api/queries';

/** El guardado de Uony refresca el catálogo; las ediciones locales no se descartan. */
export function useLiveProduct(product: CatalogProduct | null) {
  const client = useQueryClient();
  useEffect(() => {
    if (USE_MOCKS) return;
    setActiveProduct(product);
    if (product && !hasProductEdits(product)) {
      pimStore.set(product.sku, 'baseRevision', product.revision);
      pimStore.set(product.sku, 'customFields', product.customFields ?? []);
    }
    return () => setActiveProduct(null);
  }, [product]);
  useEffect(() => {
    if (USE_MOCKS) return;
    const refresh = (event: Event) => {
      const changes = (event as CustomEvent<ProductChange[]>).detail;
      for (const change of changes) {
        const previous = getCachedProducts(client).find(item => item.sku === change.product.sku) ?? null;
        if (!hasProductEdits(previous)) {
          pimStore.set(change.product.sku, 'edited', {});
          pimStore.set(change.product.sku, 'customFields', change.product.customFields ?? []);
          pimStore.set(change.product.sku, 'bullets', change.product.bullets ?? []);
          pimStore.set(change.product.sku, 'baseRevision', change.product.revision);
        }
      }
      void client.cancelQueries({ queryKey: catalogKeys.all }).then(() => {
        setCachedProducts(client, items => {
          const changed = new Set(changes.map(change => change.product.sku));
          return [...changes.map(change => change.product as CatalogProduct), ...items.filter(item => !changed.has(item.sku))];
        });
        void client.invalidateQueries({ queryKey: catalogKeys.all });
      });
    };
    window.addEventListener('uonify:products-changed', refresh);
    return () => window.removeEventListener('uonify:products-changed', refresh);
  }, [client, product]);
}
