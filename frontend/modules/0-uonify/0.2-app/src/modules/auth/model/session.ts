import { parseConsents } from './legal';
import { PLAN_LABELS } from './plans';
import { parseSessionProfile } from './profile';
import type { AuthProvider, AuthSession, ChatGPTPlanStatus, Profile, SessionPayload, SessionStatus } from './types';

export const NOT_CONNECTED: ChatGPTPlanStatus = Object.freeze({ status: 'not_connected' });

export const SIGNED_OUT: AuthSession = Object.freeze({
  authenticated: false,
  email: '',
  provider: null,
  identityName: '',
  profile: null,
  profileReady: false,
  consents: [],
  chatgptPlan: NOT_CONNECTED,
});

export const isAuthProvider = (value: unknown): value is AuthProvider => value === 'chatgpt' || value === 'google' || value === 'email';

/** Estado del plan de ChatGPT que llega del backend (conectado solo si lo dice). */
export function parseChatGPTPlan(raw: unknown): ChatGPTPlanStatus {
  if (!raw || typeof raw !== 'object') return NOT_CONNECTED;
  const data = raw as Record<string, unknown>;
  if (data.status !== 'connected') return NOT_CONNECTED;
  return {
    status: 'connected',
    email: typeof data.email === 'string' ? data.email : undefined,
    connectedAt: typeof data.connectedAt === 'string' ? data.connectedAt : undefined,
  };
}

/** Normaliza la respuesta de /api/auth/session (prototipo: isSignedIn). */
export function parseSession(payload: unknown): AuthSession {
  if (!payload || typeof payload !== 'object') return SIGNED_OUT;
  const data = payload as SessionPayload;
  if (data.authenticated !== true) return SIGNED_OUT;
  const email = typeof data.email === 'string' ? data.email : typeof data.account?.email === 'string' ? data.account.email : '';
  const provider = data.account?.provider ?? data.identity?.provider;
  return {
    authenticated: true,
    ...(data.accountDeletionPending === true ? { accountDeletionPending: true } : {}),
    ...(['identity', 'profile'].includes(data.onboardingStage ?? '') ? { onboardingStage: data.onboardingStage, onboarding: data.onboarding } : {}),
    email,
    provider: isAuthProvider(provider) ? provider : null,
    identityName: typeof data.identity?.name === 'string' ? data.identity.name.trim() : '',
    profile: parseSessionProfile(data.profile),
    profileReady: data.profileComplete === true && data.ageConfirmedAdult === true,
    consents: parseConsents(data.consents),
    chatgptPlan: parseChatGPTPlan(data.chatgptPlan),
  };
}

export function deriveStatus(session: AuthSession | undefined, loading = false): SessionStatus {
  if (loading || !session) return 'loading';
  if (!session.authenticated) return 'signed-out';
  return session.profileReady ? 'ready' : 'onboarding';
}

/** Datos del menú de cuenta (prototipo: refreshAccount, [data-account-*]). */
export interface AccountSummary {
  name: string;
  email: string;
  initial: string;
  planLabel: string;
}

export function accountSummary(status: SessionStatus, profile: Profile | null): AccountSummary {
  const signedIn = status === 'onboarding' || status === 'ready';
  const ready = status === 'ready';
  const firstName = profile?.firstName.trim() ?? '';
  const planName = ready && profile ? PLAN_LABELS[profile.desiredPlan] : '';
  return {
    name: signedIn ? (ready ? firstName || 'Mi cuenta' : 'Completar perfil') : 'Iniciar sesión',
    email: signedIn && profile?.email ? profile.email : signedIn ? 'Sesión iniciada' : 'Tu espacio Uonify',
    initial: (signedIn && ready && firstName ? firstName[0] : 'U').toUpperCase(),
    planLabel: planName ? `Plan ${planName}` : signedIn ? 'Sin plan activo' : 'Tu espacio Uonify',
  };
}

/**
 * Textos de los accesos de la web pública (prototipo: refreshAccount sobre
 * .login-link, .identity-trigger y el logotipo).
 */
export interface AuthLinks {
  loginLink: string;
  identityTrigger: string;
  homeHref: string;
  homeLabel: string;
}

export function authLinks(status: SessionStatus): AuthLinks {
  const signedIn = status === 'onboarding' || status === 'ready';
  const ready = status === 'ready';
  return {
    loginLink: signedIn ? (ready ? 'Volver a mi espacio' : 'Completar perfil') : 'Iniciar sesión',
    identityTrigger: signedIn ? (ready ? 'Ir a mi espacio' : 'Completar perfil') : 'Iniciar sesión',
    homeHref: signedIn ? '/espacio' : '/',
    homeLabel: signedIn ? 'Uonify, volver a mi espacio' : 'Uonify, ir al inicio',
  };
}
