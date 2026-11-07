import { Platform } from 'react-native';

type TenantMap = Record<string, string>;

function normalizeDomain(value: string) {
  return value.trim().toLocaleLowerCase('en-US').replace(/:\d+$/, '').replace(/\.$/, '');
}

function parseTenantMap(value: string | undefined): TenantMap {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([domain, tenant]) =>
      typeof tenant === 'string' ? [[normalizeDomain(domain), tenant.trim()]] : [],
    ));
  } catch {
    return {};
  }
}

const browserDomain = Platform.OS === 'web' && typeof location !== 'undefined'
  ? normalizeDomain(location.hostname)
  : '';
const configuredDomain = normalizeDomain(process.env.EXPO_PUBLIC_STOREFRONT_DOMAIN || '');
const hostDomain = browserDomain || configuredDomain;
const tenantsByDomain = parseTenantMap(process.env.EXPO_PUBLIC_STOREFRONT_TENANT_MAP);
const defaultTenant = process.env.EXPO_PUBLIC_TENANT_ID?.trim() || '';
const tenant = tenantsByDomain[hostDomain] || (hostDomain === configuredDomain ? defaultTenant : '');
/** Dominio registrado en la tienda (BDD); el host del navegador puede ser un alias legacy. */
const domain = configuredDomain || hostDomain;

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
