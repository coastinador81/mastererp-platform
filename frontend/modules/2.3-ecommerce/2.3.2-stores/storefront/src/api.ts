import { authorizedIdentityFetch } from '../../../../../shared/auth/cognito.mjs';
import { assertStorefrontContext, storefrontConfig } from './config';
import { fetchWithTimeout } from './request-timeout.mjs';
import type { CartLine, CustomerAddress, CustomerOrder, CustomerPaymentMethod, CustomerProfile, PayerDetails, PaymentMethod, StorefrontCatalog } from './types';

export type AssistantReply = {
  conversation_id: string;
  message: string;
  product_ids?: string[];
};

const portalUrl = (path: string) => `${storefrontConfig.api}${path}?domain=${encodeURIComponent(storefrontConfig.domain)}`;
const portalOptions = (options: RequestInit = {}) => ({ ...options, headers: { 'X-Tenant-Id': storefrontConfig.tenant, ...options.headers } });

export async function loadCatalog(nodeId?: string): Promise<StorefrontCatalog> {
  assertStorefrontContext();
  const url = `${storefrontConfig.api}/v1/storefront/catalog?domain=${encodeURIComponent(storefrontConfig.domain)}${nodeId ? `&node_id=${encodeURIComponent(nodeId)}` : ''}`;
  const response = await fetchWithTimeout(fetch, url, { headers: { 'X-Tenant-Id': storefrontConfig.tenant } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'No se pudo abrir la tienda.');
  return body as StorefrontCatalog;
}

const assistantPath = process.env.EXPO_PUBLIC_STOREFRONT_ASSISTANT_PATH?.trim() || '';
export const assistantConfigured = Boolean(assistantPath);

export async function sendAssistantMessage(message: string, conversationId?: string, nodeId?: string): Promise<AssistantReply> {
  assertStorefrontContext();
  if (!assistantPath) throw new Error('assistant_not_configured');
  const path = assistantPath.startsWith('/') ? assistantPath : `/${assistantPath}`;
  const response = await fetchWithTimeout(fetch, `${storefrontConfig.api}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': storefrontConfig.tenant },
    body: JSON.stringify({
      domain: storefrontConfig.domain,
      message,
      conversation_id: conversationId || undefined,
      node_id: nodeId || undefined,
    }),
  });
  const body = await response.json().catch(() => ({})) as Partial<AssistantReply> & { error?: { message?: string } };
  if (!response.ok || typeof body.message !== 'string' || typeof body.conversation_id !== 'string') {
    throw new Error(body.error?.message || 'assistant_unavailable');
  }
  return body as AssistantReply;
}

export const loadProfile = () => authorizedIdentityFetch(portalUrl('/v1/storefront/me'), portalOptions()) as Promise<CustomerProfile>;
export const saveProfile = (profile: Pick<CustomerProfile, 'name' | 'phone' | 'birthDate' | 'photoUrl'>) => authorizedIdentityFetch(portalUrl('/v1/storefront/me'), portalOptions({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) })) as Promise<CustomerProfile>;
export const loadAddresses = async () => (await authorizedIdentityFetch(portalUrl('/v1/storefront/me/addresses'), portalOptions()) as { items: CustomerAddress[] }).items;
export const saveAddress = (address: Omit<CustomerAddress, 'id' | 'version'>) => authorizedIdentityFetch(portalUrl('/v1/storefront/me/addresses'), portalOptions({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(address) }));
export const updateAddress = (address: CustomerAddress) => authorizedIdentityFetch(portalUrl(`/v1/storefront/me/addresses/${encodeURIComponent(address.id)}`), portalOptions({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(address) }));
export const loadPaymentMethods = async () => (await authorizedIdentityFetch(portalUrl('/v1/storefront/me/payment-methods'), portalOptions()) as { items: CustomerPaymentMethod[] }).items;
export const loadOrders = async () => (await authorizedIdentityFetch(portalUrl('/v1/storefront/orders'), portalOptions()) as { items: CustomerOrder[] }).items;
export const loadOrder = (id: string) => authorizedIdentityFetch(portalUrl(`/v1/storefront/orders/${encodeURIComponent(id)}`), portalOptions()) as Promise<CustomerOrder>;
export async function submitCheckout(lines: CartLine[], address: CustomerAddress, paymentMethod: PaymentMethod, paymentReference?: string, payer?: PayerDetails, nodeId?: string) {
  assertStorefrontContext();
  const storageKey = `mastererp.storefront.checkout-key:${storefrontConfig.tenant}:${storefrontConfig.domain}`;
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = `storefront-${crypto.randomUUID()}`;
    sessionStorage.setItem(storageKey, key);
  }
  const detail = {
    items: lines.map(({ product, quantity, variant }) => ({ product_id: product.id, quantity, variant_key: variant?.key })),
    node_id: nodeId,
    delivery: {
      address: address.address, label: address.label, zone: address.zone, unit: address.unit,
      reference: address.reference, latitude: address.latitude, longitude: address.longitude,
    },
    delivery_method: 'realtime',
    payment_method: paymentMethod.startsWith('custom:') ? 'custom' : paymentMethod,
    payment_method_id: paymentMethod.startsWith('custom:') ? paymentMethod.slice(7) : undefined,
    payment_reference: paymentReference || undefined,
  };
  window.dispatchEvent(new CustomEvent('mastererp:checkout', { detail }));
  const result = await authorizedIdentityFetch(`${storefrontConfig.api}/v1/storefront/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, 'X-Tenant-Id': storefrontConfig.tenant },
    body: JSON.stringify({ domain: storefrontConfig.domain, ...detail, payer: paymentMethod === 'mobile' || paymentMethod === 'transfer' ? payer : undefined }),
  });
  sessionStorage.removeItem(storageKey);
  return result as { number: string };
}
