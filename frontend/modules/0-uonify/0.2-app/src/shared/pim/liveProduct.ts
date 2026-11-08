import type { PimProduct } from './context/types';
import { pimStore } from './store/pimStore';

export interface ProductChange { product: PimProduct; previousSku: string | null }
let active: PimProduct | null = null;
export function setActiveProduct(product: PimProduct | null) {
  const previous = activeProductContext();
  active = product;
  const current = activeProductContext();
  if (previous?.sku !== current?.sku || previous?.revision !== current?.revision) {
    window.dispatchEvent(new CustomEvent('uonify:active-product-changed', { detail: current }));
  }
}
export function activeProductContext() {
  return active && typeof active.revision === 'number' ? { sku: active.sku, revision: active.revision } : null;
}
export function hasProductEdits(product: PimProduct | null = active): boolean {
  if (!product) return false;
  const state = pimStore.all(product.sku);
  if (Object.keys((state.edited as object) ?? {}).length > 0) return true;
  return ['bullets', 'customFields'].some(key => state[key] !== undefined && JSON.stringify(state[key]) !== JSON.stringify(product[key] ?? []));
}
export function notifyProductChanges(changes: ProductChange[]) {
  window.dispatchEvent(new CustomEvent('uonify:products-changed', { detail: changes }));
}
/** La acción visible prepara la petición en el chat; la persona la revisa y envía. */
export function askProductAssistant(text: string, productLink?: { sku: string; revision: number }) {
  window.dispatchEvent(new CustomEvent('uonify:product-prompt', { detail: productLink ? { text, productLink } : text }));
}
if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => { active = null; pimStore.clear(); });
