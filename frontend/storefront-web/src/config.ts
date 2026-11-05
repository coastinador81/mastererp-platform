import { Platform } from 'react-native';

const webHost = Platform.OS === 'web' && typeof location !== 'undefined' ? location.hostname : '';

export const storefrontConfig = {
  api: process.env.EXPO_PUBLIC_STOREFRONT_API_URL || '',
  tenant: process.env.EXPO_PUBLIC_TENANT_ID || '',
  domain: process.env.EXPO_PUBLIC_STOREFRONT_DOMAIN || webHost,
};

export function storefrontScope() {
  return `${storefrontConfig.tenant}:${storefrontConfig.domain}`;
}
