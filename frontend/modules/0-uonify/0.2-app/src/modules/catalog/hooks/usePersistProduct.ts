import { currentAccountEmail } from '@/modules/auth';
import { USE_MOCKS } from '@/shared/api/config';
import { useCallback, type RefObject } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { notifyProductChanges, pimStore, type PersistOptions, type PimEdited, type PimProduct } from '@/shared/pim';
import { createProduct, updateProduct } from '../api/products';
import { getCachedProducts, setCachedProducts } from '../api/queries';
import { MSG_SKU_TAKEN, cloneProduct, isSkuTaken, mergeSaved, requiredFields, resolvePersistTarget } from '../model/catalogRules';
import { productPath, sheetKey } from '../model/paths';
import type { ProductRoute } from '../model/types';
import { useCatalogStore } from './useCatalogStore';

/**
 * `ctx.persist(data, { create, key })` de las pestañas (prototipo: persistProduct).
 * Guarda en el catálogo (POST o PATCH /products) y, si el SKU cambia, mueve al SKU
 * guardado el estado de las pestañas, la selección y los canales. Si la ficha de ese
 * producto sigue en pantalla, la URL pasa al SKU guardado; si la persona ya abrió
 * otro, el guardado cae en el suyo sin cambiar lo que está viendo.
 */
export function usePersistProduct(routeRef: RefObject<ProductRoute>) {
  const client = useQueryClient();
  const navigate = useNavigate();
  return useCallback(async (data: PimEdited, options: PersistOptions = {}): Promise<PimProduct> => {
    const account = currentAccountEmail();
    const { name, sku } = requiredFields(data);
    const start = routeRef.current;
    const { target, fromKey } = resolvePersistTarget({ create: options.create, key: options.key, currentSku: start.sku });
    const products = getCachedProducts(client);
    const exists = target !== null && products.some(item => item.sku === target);
    if (isSkuTaken(products, sku, exists ? target : null)) throw new Error(MSG_SKU_TAKEN);
    const payload = { ...data, name, sku, ...(!USE_MOCKS && exists && target ? { revision: pimStore.get(target, 'baseRevision', products.find(item => item.sku === target)?.revision) } : {}) };
    const saved = exists && target !== null ? await updateProduct(target, payload) : await createProduct(payload);
    if (!USE_MOCKS && currentAccountEmail() !== account) throw new Error('La sesión ha cambiado. Abre el catálogo de tu cuenta actual.');
    if (!USE_MOCKS) pimStore.set(saved.sku, 'baseRevision', saved.revision);
    const now = routeRef.current;
    const onScreen = options.create ? now.isNew : target !== null ? now.sku === target : now.isNew;
    const moves = onScreen && (now.isNew || now.sku !== saved.sku);
    const store = useCatalogStore.getState();
    // Todo en el mismo pintado: la vista ya enseña el producto guardado aunque la
    // URL cambie un instante después.
    if (moves) store.setRedirect({ from: sheetKey(now), sku: saved.sku });
    setCachedProducts(client, list => mergeSaved(list, saved, exists ? target : null));
    if (fromKey && fromKey !== saved.sku) {
      pimStore.rename(fromKey, saved.sku);
      store.renameSku(fromKey, saved.sku);
    }
    if (!USE_MOCKS) notifyProductChanges([{ product: saved, previousSku: exists ? target : null }]);
    if (onScreen) {
      if (moves) navigate(productPath({ sku: saved.sku, tab: now.tab }), { replace: true });
      if (!store.drawer.pinned) store.setDrawer({ open: false, pinned: false });
    }
    return cloneProduct(saved);
  }, [client, navigate, routeRef]);
}
