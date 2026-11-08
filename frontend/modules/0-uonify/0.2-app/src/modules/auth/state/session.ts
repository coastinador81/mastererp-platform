import { USE_MOCKS } from '@/shared/api/config';
import { queryClient } from '@/shared/api/queryClient';
import { fetchAuthConfig, fetchSessionState } from '../api/authApi';
import { SIGNED_OUT } from '../model/session';
import { clearConfirmedSessionLoss } from '../model/sessionLoss';
import type { AuthConfig, AuthSession, ChatGPTPlanStatus, ConsentRecord, Profile } from '../model/types';

/**
 * La sesión es estado de servidor: vive en TanStack Query y los flujos imperativos
 * la leen y actualizan con el mismo queryClient. La clave lleva «normalized» para
 * no mezclarse con quien guarde la respuesta cruda en ['auth','session']; invalidar
 * ['auth','session'] (prefijo) también la refresca.
 */
export const SESSION_KEY = ['auth', 'session', 'normalized'] as const;
export const CONFIG_KEY = ['auth', 'config'] as const;

let lastKnownAccount: string | null = null;

// Un fallo transitorio cierra la vista, pero no confirma que deban borrarse sus borradores.
async function loadSession(): Promise<AuthSession> {
  const previous = currentAccountEmail() ?? lastKnownAccount;
  try {
    const { session, confirmedSignedOut } = await fetchSessionState();
    const current = currentAccountEmail();
    if (current && previous !== current) return currentSession();
    if (session.authenticated) lastKnownAccount = session.email;
    else if (confirmedSignedOut && previous) {
      clearConfirmedSessionLoss(previous);
      lastKnownAccount = null;
    }
    return session;
  } catch {
    return SIGNED_OUT;
  }
}

export const sessionQuery = {
  queryKey: SESSION_KEY,
  queryFn: loadSession,
  staleTime: USE_MOCKS ? Infinity : 30_000,
  gcTime: Infinity,
  retry: false,
  refetchOnWindowFocus: 'always',
} as const;

/** Sesión actual (la pide al backend la primera vez). */
export function ensureSession(): Promise<AuthSession> {
  return queryClient.fetchQuery(sessionQuery);
}

export function currentSession(): AuthSession {
  return queryClient.getQueryData<AuthSession>(SESSION_KEY) ?? SIGNED_OUT;
}

/**
 * Correo de la cuenta con la sesión abierta, o null. Para lo que otros módulos
 * guardan «por cuenta» en el navegador (p. ej. la aceptación de las condiciones
 * de vídeo con IA); en el prototipo salía de localStorage 'uonify-session'.
 */
export function currentAccountEmail(): string | null {
  const session = currentSession();
  return session.authenticated && session.email ? session.email : null;
}

export function setSession(session: AuthSession): void {
  lastKnownAccount = session.authenticated ? session.email : null;
  queryClient.setQueryData(SESSION_KEY, session);
}

/** Actualiza parte de la sesión en caché (aceptaciones, plan de ChatGPT…). */
export function patchSession(patch: Partial<AuthSession>): void {
  const session = currentSession();
  if (!session.authenticated) return;
  setSession({ ...session, ...patch });
}

export const setSessionConsents = (consents: ConsentRecord[]): void => patchSession({ consents });
export const setSessionPlan = (chatgptPlan: ChatGPTPlanStatus): void => patchSession({ chatgptPlan });

/** Tras guardar el perfil: la sesión pasa a lista. */
export function markProfileReady(profile: Profile): void {
  const session = currentSession();
  setSession({ ...session, authenticated: true, profile, profileReady: true });
}

// Un fallo no se transforma en una configuración de acceso distinta ni se guarda como éxito.
export const configQuery = { queryKey: CONFIG_KEY, queryFn: fetchAuthConfig, staleTime: 60_000, gcTime: Infinity, retry: false } as const;

export function ensureAuthConfig(): Promise<AuthConfig> {
  return queryClient.fetchQuery({ ...configQuery, staleTime: 0 });
}
