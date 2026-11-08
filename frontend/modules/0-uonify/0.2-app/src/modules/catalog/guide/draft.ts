import { queryClient } from '@/shared/api/queryClient';
import { pimStore, type PimEdited } from '@/shared/pim';
import { getCachedProducts, setCachedProducts } from '../api/queries';
import { mergeSaved } from '../model/catalogRules';
import type { CatalogProduct } from '../model/types';
import { GUIDE_SKU } from './model';

export function cacheGuideProduct(product: CatalogProduct): void {
  setCachedProducts(queryClient, products => mergeSaved(products, product, product.sku));
}
export function guideDraft(sku = GUIDE_SKU): CatalogProduct | undefined {
  const product = getCachedProducts(queryClient).find(item => item.sku === sku);
  if (!product) return undefined;
  return { ...product, ...pimStore.get<PimEdited>(sku, 'edited', {}) } as CatalogProduct;
}
export function guideSnapshot(sku = GUIDE_SKU) {
  const product = guideDraft(sku);
  const slices = pimStore.all(sku);
  const { edited: _edited, sampleSeeded: _seeded, ...content } = slices;
  return { product, slices: content };
}
export function fingerprint(sku = GUIDE_SKU): string {
  const { product, slices } = guideSnapshot(sku);
  // Se comparan contenidos, no fechas internas del editor A+ ni el estado de publicación.
  return JSON.stringify({ ...product, status: undefined, createdAt: undefined, slices }, (key, value: unknown) =>
    ['timestamp', 'hasUnsavedChanges', 'isGenerating3D', 'generation3DProgress'].includes(key) ? undefined : value);
}
export function editGuideProduct(patch: Partial<CatalogProduct>, sku = GUIDE_SKU): void {
  pimStore.update<PimEdited>(sku, 'edited', edited => ({ ...edited, ...patch }), {});
}
