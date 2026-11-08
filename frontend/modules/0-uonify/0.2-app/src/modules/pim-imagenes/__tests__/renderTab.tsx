import { act, render } from '@testing-library/react';
import { pimStore, PimTabHost, type PimProduct, type PimTabContext } from '@/shared/pim';
import { toast, Toaster } from '@/shared/ui';
import { clearCatalogImagesCache } from '../api/imagesApi';
import { tab } from '../index';
import type { ImageItem } from '../model/types';
import { resetImagesMemory } from '../state/memory';

/** Utilidades de las pruebas de la pestaña (no es un archivo de pruebas). */

export const SKU = 'UON-KIT-01';

export const sampleProduct = (patch: Partial<PimProduct> = {}): PimProduct => ({
  sku: SKU,
  name: 'Make It Possible by Uonify',
  brand: 'Uonify',
  category: 'Juegos de construcción',
  source: 'uonify',
  ...patch,
});

export function makeContext(key: string, product: PimProduct | null): PimTabContext {
  return {
    key,
    isNew: product === null,
    product,
    store: pimStore.scope(key),
    draft: () => ({ ...(product ?? {}), ...pimStore.get<Record<string, unknown>>(key, 'edited', {}) }),
    edit: patch => {
      pimStore.update<Record<string, unknown>>(key, 'edited', edited => ({ ...edited, ...patch }), {});
    },
    persist: async data => ({ sku: String(data.sku ?? key), name: String(data.name ?? '') }),
    skuTaken: () => false,
    channels: () => ({ Amazon: false }),
    switchTab: () => {},
  };
}

export function renderTab(key: string = SKU, product: PimProduct | null = sampleProduct()) {
  return render(
    <>
      <PimTabHost tab={tab} context={makeContext(key, product)} />
      <Toaster />
    </>,
  );
}

export const upload = (id: string, name: string, patch: Partial<ImageItem> = {}): ImageItem => ({
  id,
  url: `/assets/jenga/ficha/${name}`,
  name,
  size: 2048,
  type: 'image/jpeg',
  source: 'upload',
  status: 'pending',
  dimensions: { width: 2000, height: 2000 },
  ...patch,
});

/** Estado limpio entre pruebas. */
export function resetAll(): void {
  act(() => toast.dismiss());
  resetImagesMemory();
  pimStore.clear();
  clearCatalogImagesCache();
  localStorage.clear();
}
