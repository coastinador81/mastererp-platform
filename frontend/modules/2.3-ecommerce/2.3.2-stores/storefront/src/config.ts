import { Platform } from 'react-native';
import { resolveStorefrontContext } from './storefront-context.mjs';

const browserDomain = Platform.OS === 'web' && typeof location !== 'undefined'
  ? location.hostname
  : '';
const { domain, hostDomain, tenant } = resolveStorefrontContext({
  browserDomain,
  configuredDomain: process.env.EXPO_PUBLIC_STOREFRONT_DOMAIN || '',
  tenantMapValue: process.env.EXPO_PUBLIC_STOREFRONT_TENANT_MAP,
  defaultTenant: process.env.EXPO_PUBLIC_TENANT_ID || '',
});

export const storefrontConfig = {
  api: (process.env.EXPO_PUBLIC_STOREFRONT_API_URL || '').replace(/\/$/, ''),
  tenant,
  domain,
  hostDomain,
};

export function assertStorefrontContext() {
  if (!storefrontConfig.api) throw new Error('La API de la tienda no está configurada.');
  if (!storefrontConfig.domain) throw new Error('No se pudo resolver el dominio de la tienda.');
  if (!storefrontConfig.tenant) {
    throw new Error('Este dominio no está asociado a un tenant habilitado.');
  }
}

export function storefrontScope() {
  return `${storefrontConfig.tenant}:${storefrontConfig.domain}`;
}
