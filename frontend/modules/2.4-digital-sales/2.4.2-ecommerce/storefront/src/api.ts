import { authorizedIdentityFetch } from '../../../../../shared/auth/cognito.mjs';
import { assertStorefrontContext, storefrontConfig } from './config';
import type { CartLine, CustomerAddress, CustomerOrder, CustomerProfile, PaymentMethod, StorefrontCatalog } from './types';

const portalUrl = (path: string) => `${storefrontConfig.api}${path}?domain=${encodeURIComponent(storefrontConfig.domain)}`;
const portalOptions = (options: RequestInit = {}) => ({ ...options, headers: { 'X-Tenant-Id': storefrontConfig.tenant, ...options.headers } });

export async function loadCatalog(): Promise<StorefrontCatalog> {
  assertStorefrontContext();
  const url = `${storefrontConfig.api}/v1/storefront/catalog?domain=${encodeURIComponent(storefrontConfig.domain)}`;
  const response = await fetch(url, { headers: { 'X-Tenant-Id': storefrontConfig.tenant } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'No se pudo abrir la tienda.');
  return body as StorefrontCatalog;
}

export const loadProfile = () => authorizedIdentityFetch(portalUrl('/v1/storefront/me'), portalOptions()) as Promise<CustomerProfile>;
export const saveProfile = (profile: Pick<CustomerProfile, 'name' | 'phone' | 'birthDate' | 'photoUrl'>) => authorizedIdentityFetch(portalUrl('/v1/storefront/me'), portalOptions({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })) as Promise<CustomerProfile>;
export const loadAddresses = async () => (await authorizedIdentityFetch(portalUrl('/v1/storefront/me/addresses'), portalOptions()) as { items: CustomerAddress[] }).items;
export const saveAddress = (address: Omit<CustomerAddress, 'id' | 'version'>) => authorizedIdentityFetch(portalUrl('/v1/storefront/me/addresses'), portalOptions({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(address) }));
export const loadOrders = async () => (await authorizedIdentityFetch(portalUrl('/v1/storefront/orders'), portalOptions()) as { items: CustomerOrder[] }).items;
export const loadOrder = (id: string) => authorizedIdentityFetch(portalUrl(`/v1/storefront/orders/${encodeURIComponent(id)}`), portalOptions()) as Promise<CustomerOrder>;

export async function submitCheckout(lines: CartLine[], address: string | CustomerAddress, paymentMethod: PaymentMethod, paymentReference?: string) {
  assertStorefrontContext();
  const storageKey = `mastererp.storefront.checkout-key:${storefrontConfig.tenant}:${storefrontConfig.domain}`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = `storefront-${crypto.randomUUID()}`;
    sessionStorage.setItem(storageKey, key);
  }
  const detail = {
    items: lines.map(({ product, quantity }) => ({ product_id: product.id, quantity })),
    delivery: typeof address === 'string' ? { address } : {
      address: address.address, label: address.label, zone: address.zone, unit: address.unit,
      reference: address.reference, latitude: address.latitude, longitude: address.longitude,
    },
    delivery_method: 'realtime',
    payment_method: paymentMethod,
    payment_reference: paymentReference || undefined,
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
