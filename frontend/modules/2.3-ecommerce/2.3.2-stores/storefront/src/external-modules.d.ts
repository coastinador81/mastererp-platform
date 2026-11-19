declare module '*.css';

declare module '../../../../../shared/auth/cognito.mjs' {
  export const authorizedIdentityFetch: (url: string, options?: RequestInit) => Promise<unknown>;
  export const completeLogin: (config: AuthConfig, href?: string) => Promise<void>;
  export const login: (config: AuthConfig, options?: { identityProvider?: string; screen?: string }) => Promise<void>;
  export const logout: (config: AuthConfig) => void;
  export const sessionExpiresAt: () => number;
}

declare module './request-timeout.mjs' {
  export const STOREFRONT_REQUEST_TIMEOUT_MS: number;
  export function fetchWithTimeout(
    fetcher: typeof fetch,
    url: string,
    options?: RequestInit,
    timeoutMs?: number,
  ): Promise<Response>;
}

declare module './storefront-context.mjs' {
  export function resolveStorefrontContext(input: {
    browserDomain: string;
    configuredDomain: string;
    tenantMapValue?: string;
    defaultTenant: string;
  }): { domain: string; hostDomain: string; tenant: string };
}

type AuthConfig = {
  clientId: string;
  loginBaseUrl: string;
  callbackUrl: string;
  logoutUrl: string;
  scopes: string[];
};
