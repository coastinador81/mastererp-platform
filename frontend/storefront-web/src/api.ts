import { authorizedIdentityFetch } from '../../shared/auth/cognito.mjs';
import { assertStorefrontContext, storefrontConfig } from './config';
import type { CartLine, StorefrontCatalog } from './types';

export async function loadCatalog(): Promise<StorefrontCatalog> {
  assertStorefrontContext();
  const url = `${storefrontConfig.api}/v1/storefront/catalog?domain=${encodeURIComponent(storefrontConfig.domain)}`;
  const response = await fetch(url, { headers: { 'X-Tenant-Id': storefrontConfig.tenant } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'No se pudo abrir la tienda.');
  return body as StorefrontCatalog;
}

export async function submitCheckout(lines: CartLine[], address: string) {
  assertStorefrontContext();
  const storageKey = `mastererp.storefront.checkout-key:${storefrontConfig.tenant}:${storefrontConfig.domain}`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = `storefront-${crypto.randomUUID()}`;
    sessionStorage.setItem(storageKey, key);
  }
  const detail = {
    items: lines.map(({ product, quantity }) => ({ product_id: product.id, quantity })),
    delivery: { address },
    delivery_method: 'realtime',
    payment_method: 'cash',
  };
  window.dispatchEvent(new CustomEvent('mastererp:checkout', { detail }));
  const result = await authorizedIdentityFetch(`${storefrontConfig.api}/v1/storefront/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Tenant-Id': storefrontConfig.tenant },
    body: JSON.stringify({ domain: storefrontConfig.domain, ...detail }),
  });
  sessionStorage.removeItem(storageKey);
  return result as { number: string };
}
