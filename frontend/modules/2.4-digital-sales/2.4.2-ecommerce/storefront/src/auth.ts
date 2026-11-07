import authConfig from '../auth-config.json';
import { authorizedIdentityFetch, completeLogin, login, logout, sessionExpiresAt } from '../../../../../shared/auth/cognito.mjs';
import { assertStorefrontContext, storefrontConfig, storefrontScope } from './config';

const invitationKey = () => `mastererp.storefront.invitation:${storefrontScope()}`;

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
    await authorizedIdentityFetch(`${storefrontConfig.api}/v1/storefront/identity/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': storefrontConfig.tenant },
      body: JSON.stringify({ invitation_token: pendingInvitation }),
    });
    sessionStorage.removeItem(invitationKey());
  }
  if (authenticated && !pendingInvitation) {
    await authorizedIdentityFetch(`${storefrontConfig.api}/v1/storefront/identity/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': storefrontConfig.tenant },
      body: JSON.stringify({ domain: storefrontConfig.domain }),
    });
  }
  return authenticated;
}
