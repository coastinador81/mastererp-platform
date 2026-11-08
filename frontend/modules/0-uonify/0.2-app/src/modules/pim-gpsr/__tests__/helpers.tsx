import { render } from '@testing-library/react';
import { NEW_PRODUCT_KEY, PimTabHost, pimStore, type PimEdited, type PimProduct, type PimTabContext, type PimTabDefinition } from '@/shared/pim';
import { Toaster } from '@/shared/ui';

/**
 * Ficha simulada para las pruebas: el contexto que construye catalog
 * (edit en `edited`, persist que devuelve el producto guardado y mueve
 * '__new__' a su SKU al crear).
 */
export function makeContext(product: PimProduct | null, extra: Partial<PimTabContext> = {}): PimTabContext & { persist: ReturnType<typeof vi.fn> } {
  const key = product?.sku ?? NEW_PRODUCT_KEY;
  const persist = vi.fn(async (data: PimEdited, options: { create?: boolean; key?: string | null } = {}) => {
    const name = String(data.name ?? '').trim();
    const sku = String(data.sku ?? '').trim();
    if (!name || !sku) throw new Error('El nombre y el SKU son obligatorios.');
    if (options.create) pimStore.rename(NEW_PRODUCT_KEY, sku);
    return { ...(product ?? {}), ...data, name, sku } as PimProduct;
  });
  return {
    key,
    isNew: !product,
    product,
    store: pimStore.scope(key),
    draft: () => ({ ...(product ?? {}), ...pimStore.get<PimEdited>(key, 'edited', {}) }) as PimProduct,
    edit: patch => { pimStore.update<PimEdited>(key, 'edited', edited => ({ ...(edited || {}), ...patch }), {}); },
    persist,
    skuTaken: () => false,
    channels: () => ({ Amazon: false }),
    switchTab: vi.fn(),
    ...extra,
  } as PimTabContext & { persist: ReturnType<typeof vi.fn> };
}

export function renderTab(tab: PimTabDefinition, context: PimTabContext) {
  return render(
    <>
      <PimTabHost tab={tab} context={context} />
      <Toaster />
    </>,
  );
}
