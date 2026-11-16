import authConfig from '../auth-config.json';
import {
  ApiError,
  completeLogin,
  identityToken,
  login,
  logout,
  restoreSession,
  sessionExpiresAt,
} from '../../../../../shared/auth/cognito.mjs';
import { assertStorefrontContext, storefrontConfig, storefrontScope } from './config';
import { fetchWithTimeout } from './request-timeout.mjs';

const localOrigin = typeof window !== 'undefined' && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  ? window.location.origin
  : '';
const effectiveAuthConfig = localOrigin ? {
  ...authConfig,
  callbackUrl: `${localOrigin}/auth/callback`,
  logoutUrl: `${localOrigin}/`,
} : authConfig;
const invitationKey = () => `mastererp.storefront.invitation:${storefrontScope()}`;

async function postStorefrontIdentity(path: string, body: Record<string, unknown>) {
  const token = identityToken();
  if (!token) return { ok: false, status: 401, code: 'session_expired' as const };
  const response = await fetchWithTimeout(fetch, `${storefrontConfig.api}${path}`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': storefrontConfig.tenant,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  const code = typeof payload?.error?.code === 'string' ? payload.error.code : 'request_failed';
  return { ok: response.ok, status: response.status, code };
}

export const isAuthenticated = () => sessionExpiresAt() > Date.now();
export function sessionEmail() {
  try {
    const payload = identityToken()?.split('.')[1];
    if (!payload) return '';
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims.email === 'string' ? claims.email : '';
  } catch { return ''; }
}
export const startLogin = (provider?: 'Google') => login(effectiveAuthConfig, provider ? { identityProvider: provider } : {});
export const startRegistration = () => login(effectiveAuthConfig, { screen: 'signup' });
export const signOut = () => logout(effectiveAuthConfig);

export async function completeLoginIfNeeded() {
  if (typeof window === 'undefined') return false;
  assertStorefrontContext();
  if (window.location.pathname === '/auth/callback') {
    const callback = new URL(window.location.href);
    const oauthError = callback.searchParams.get('error');
    if (oauthError) {
      const description = callback.searchParams.get('error_description') || oauthError;
      window.history.replaceState(null, '', '/');
      throw new Error(`Cognito rechazó el acceso: ${description}`);
    }
  }
  const invitation = new URL(window.location.href).searchParams.get('invite');
  if (invitation) {
    sessionStorage.setItem(invitationKey(), invitation);
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }
  if (window.location.pathname === '/auth/callback') {
    await completeLogin(effectiveAuthConfig);
  } else if (!isAuthenticated()) {
    await restoreSession(effectiveAuthConfig);
  }
  const authenticated = isAuthenticated();
  const pendingInvitation = sessionStorage.getItem(invitationKey());
  if (authenticated && pendingInvitation) {
    const claim = await postStorefrontIdentity('/v1/storefront/identity/claim', {
      invitation_token: pendingInvitation,
    });
    if (!claim.ok) {
      throw new ApiError(claim.status, claim.code);
    }
    sessionStorage.removeItem(invitationKey());
  }
  if (authenticated && !pendingInvitation) {
    const register = await postStorefrontIdentity('/v1/storefront/identity/register', {
      domain: storefrontConfig.domain,
    });
    if (!register.ok && register.status !== 401 && register.status !== 403) {
      throw new ApiError(register.status, register.code);
    }
    if (!register.ok && (register.status === 401 || register.status === 403)) {
      sessionStorage.setItem(
        `mastererp.storefront.identity-hint:${storefrontScope()}`,
        register.status === 401
          ? 'Verifica tu correo en Cognito (email_verified) para usar checkout y tu perfil.'
          : 'No se pudo vincular tu cuenta con la tienda. Intenta cerrar sesión o contacta soporte.',
      );
    } else {
      sessionStorage.removeItem(`mastererp.storefront.identity-hint:${storefrontScope()}`);
    }
  }
  return authenticated;
}

export function identityRegistrationHint() {
  if (typeof sessionStorage === 'undefined') return '';
  return sessionStorage.getItem(`mastererp.storefront.identity-hint:${storefrontScope()}`) || '';
}
