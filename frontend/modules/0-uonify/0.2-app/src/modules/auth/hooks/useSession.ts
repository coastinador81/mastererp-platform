import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { deriveStatus, SIGNED_OUT } from '../model/session';
import type { AuthSession, AuthUser, Profile, SessionStatus } from '../model/types';
import { sessionQuery } from '../state/session';

export interface SessionState {
  accountDeletionPending: boolean;
  status: SessionStatus;
  user: AuthUser | null;
  profile: Profile | null;
}

/**
 * Estado de la sesión: 'loading' mientras se consulta /api/auth/session,
 * 'signed-out', 'onboarding' (sesión iniciada con el alta sin terminar) o 'ready'.
 */
export function useSession(): SessionState {
  const { data, isPending } = useQuery(sessionQuery);
  return useMemo(() => {
    const status = deriveStatus(data, isPending);
    const signedIn = status === 'onboarding' || status === 'ready';
    return {
      accountDeletionPending: data?.authenticated === true && data.accountDeletionPending === true,
      status,
      user: signedIn && data ? { email: data.email, provider: data.provider } : null,
      profile: signedIn ? data?.profile ?? null : null,
    };
  }, [data, isPending]);
}

/** Sesión completa (aceptaciones, plan de ChatGPT, proveedor) para los pasos del alta. */
export function useAuthSession(): AuthSession {
  const { data } = useQuery(sessionQuery);
  return data ?? SIGNED_OUT;
}
