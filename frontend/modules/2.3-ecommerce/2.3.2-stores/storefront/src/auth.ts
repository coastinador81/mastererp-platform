import authConfig from '../auth-config.json';
import {
  ApiError,
  completeLogin,
  identityToken,
  login,
  logout,
  sessionExpiresAt,
} from '../../../../../shared/auth/cognito.mjs';
import { assertStorefrontContext, storefrontConfig, storefrontScope } from './config';

const invitationKey = () => `mastererp.storefront.invitation:${storefrontScope()}`;

async function postStorefrontIdentity(path: string, body: Record<string, unknown>) {
  const token = identityToken();
  if (!token) return { ok: false, status: 401, code: 'session_expired' as const };
  const response = await fetch(`${storefrontConfig.api}${path}`, {
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
export const startLogin = (provider?: 'Google') => login(authConfig, provider ? { identityProvider: provider } : {});
export const startRegistration = () => login(authConfig, { screen: 'signup' });
export const signOut = () => logout(authConfig);

export async function completeLoginIfNeeded() {
  if (typeof window === 'undefined') return false;
  assertStorefrontContext();
  const invitation = new URL(window.location.href).searchParams.get('invite');
  if (invitation) {
    sessionStorage.setItem(invitationKey(), invitation);
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }
  if (window.location.pathname === '/auth/callback') {
    await completeLogin(authConfig);
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
