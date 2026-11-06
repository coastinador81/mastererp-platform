/// <reference types="expo/types" />

declare module '../../shared/auth/cognito.mjs' {
  export const authorizedIdentityFetch: (url: string, options?: RequestInit) => Promise<unknown>;
  export const completeLogin: (config: AuthConfig, href?: string) => Promise<void>;
  export const login: (config: AuthConfig, options?: { identityProvider?: string; screen?: string }) => Promise<void>;
  export const logout: (config: AuthConfig) => void;
  export const sessionExpiresAt: () => number;
}

type AuthConfig = {
  clientId: string;
  loginBaseUrl: string;
  callbackUrl: string;
  logoutUrl: string;
  scopes: string[];
};
