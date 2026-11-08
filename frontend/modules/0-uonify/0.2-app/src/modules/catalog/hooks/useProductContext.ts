import { USE_MOCKS } from '@/shared/api/config';
import { useLayoutEffect, useMemo, useReducer, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  NEW_PRODUCT_KEY,
  getDefaultCustomFields,
  pimStore,
  type PersistOptions,
  type PimEdited,
  type PimProduct,
  type PimTabContext,
  type PimTabKey,
} from '@/shared/pim';
import { searchProductTypes } from '../api/products';
import { fetchSample, getCachedProducts } from '../api/queries';
import { cloneProduct, isSkuTaken } from '../model/catalogRules';
import { seedCustomFields, seedSampleSlices } from '../model/sampleSeeding';
import type { CatalogProduct } from '../model/types';
import { channelStatesOf, useCatalogStore } from './useCatalogStore';

/** Clave del almacén del PIM de la ficha: su SKU o '__new__'. */
export const pimKeyOf = (product: CatalogProduct | null): string => product?.sku ?? NEW_PRODUCT_KEY;

interface ContextInput {
  product: CatalogProduct | null;
  persist: (data: PimEdited, options?: PersistOptions) => Promise<PimProduct>;
  switchTab: (tab: PimTabKey) => void;
}

/**
 * El `ctx` de cada pestaña (prototipo: pimContext de app-shell.js): producto, su
 * ámbito del almacén, borrador, edición en vivo de la cabecera, guardado, canales
 * activos, cambio de pestaña y búsqueda de categorías de Amazon.
 */
export function useProductContext({ product, persist, switchTab }: ContextInput): PimTabContext {
  const client = useQueryClient();
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const key = pimKeyOf(product);
  return useMemo<PimTabContext>(() => {
    const scope = pimStore.scope(key);
    const ownSku = product ? product.sku : null;
    return {
      key,
      isNew: !product,
      product: product ? cloneProduct(product) : null,
      store: scope,
      draft: () => ({ ...(product ? cloneProduct(product) : {}), ...(scope.get<PimEdited>('edited') || {}) }),
      edit: patch => {
        scope.update<PimEdited>('edited', edited => ({ ...(edited || {}), ...patch }), {});
      },
      persist,
      // Si un SKU ya es de otro producto (se comprueba antes de sincronizar canales).
      skuTaken: sku => isSkuTaken(getCachedProducts(client), sku, ownSku),
      channels: () => ({ Amazon: channelStatesOf(useCatalogStore.getState().channelStates, ownSku, ['Amazon']).Amazon }),
      switchTab,
      rerender,
      categorySearch: text => USE_MOCKS ? searchProductTypes(text) : Promise.resolve({ productTypes: [] }),
    };
  }, [key, product, persist, switchTab, client]);
}

// Fichas ya preparadas («clave|ejemplo»): un almacén externo, así la preparación
// avisa sin setState dentro del efecto. Eliminar o vaciar el producto la olvida.
const prepared = new Set<string>();
const preparedListeners = new Set<() => void>();
const notifyPrepared = () => preparedListeners.forEach(listener => listener());
const subscribePrepared = (listener: () => void) => {
  preparedListeners.add(listener);
  return () => {
    preparedListeners.delete(listener);
  };
};
pimStore.subscribe(event => {
  if (event.type === 'set') return;
  const gone = event.type === 'clear' ? null : event.type === 'drop' ? event.key : event.from;
  [...prepared].forEach(entry => {
    if (gone === null || entry.startsWith(`${gone}|`)) prepared.delete(entry);
  });
  notifyPrepared();
});

/**
 * Antes de montar la pestaña de una ficha: siembra las porciones del producto de
 * ejemplo (si lo es) y la lista inicial de campos personalizados. Devuelve si la
 * ficha está lista; mientras tanto se ve «Cargando…», como el prototipo.
 */
export function useSheetPreparation(product: CatalogProduct | null, enabled: boolean): boolean {
  const client = useQueryClient();
  const key = pimKeyOf(product);
  const sampleId = typeof product?.sample === 'string' ? product.sample : '';
  const prepKey = enabled ? `${key}|${sampleId}` : '';
  const ready = useSyncExternalStore(subscribePrepared, () => Boolean(prepKey) && prepared.has(prepKey), () => false);
  useLayoutEffect(() => {
    if (!prepKey || prepared.has(prepKey)) return undefined;
    let alive = true;
    const scope = pimStore.scope(key);
    const finish = () => {
      if (!alive) return;
      if (USE_MOCKS) seedCustomFields(scope, product, key, getDefaultCustomFields());
      else if (product && scope.get('customFields') === undefined) scope.set('customFields', product.customFields ?? []);
      if (!USE_MOCKS && product && scope.get('baseRevision') === undefined) scope.set('baseRevision', product.revision);
      prepared.add(prepKey);
      notifyPrepared();
    };
    if (sampleId) {
      fetchSample(client, sampleId).then(sample => {
        if (alive) seedSampleSlices(scope, sample);
        finish();
      }, finish);
    } else finish();
    return () => {
      alive = false;
    };
    // El producto se lee al preparar; cambiar sus datos (guardar) no vuelve a prepararlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepKey, client, ready]);
  return ready;
}
