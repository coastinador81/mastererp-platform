import { useQuery } from '@tanstack/react-query';
import { USE_MOCKS } from '@/shared/api/config';
import { api } from '@/shared/api/client';
import { useMemo } from 'react';
import { accountSummary, authLinks, type AccountSummary, type AuthLinks } from '../model/session';
import { useAuthSession, useSession } from './useSession';

/**
 * Datos del menú de cuenta del espacio (prototipo: [data-account-name],
 * [data-account-email], [data-account-initial] y [data-account-plan]).
 */
export function useAccountSummary(): AccountSummary {
  const { status, profile, user } = useSession();
  const session = useAuthSession();
  const access = useQuery({ queryKey:['account-access',profile?.email], queryFn:()=>api.get<{status:string;basis?:string}>('/billing/workspace-access'), enabled:!USE_MOCKS && status==='ready', retry:false });
  return useMemo(() => {
    const summary = accountSummary(status,profile);
    if (!USE_MOCKS && status === 'onboarding') {
      const name = profile?.firstName.trim() || session.identityName.trim();
      summary.email = user?.email ?? summary.email;
      if (name) { summary.name = name; summary.initial = name[0].toUpperCase(); }
    }
    if (!USE_MOCKS && status==='ready') summary.planLabel = access.data?.status==='allowed' ? access.data.basis==='trial' ? 'Prueba de Uonify' : 'Suscripción Uonify' : access.data ? 'Revisar suscripción' : 'Comprobando suscripción';
    return summary;
  },[status,profile,user?.email,session.identityName,access.data]);
}

/**
 * Textos y destino de los accesos de la web pública (prototipo: .login-link,
 * .identity-trigger y el logotipo de Uonify).
 */
export function useAuthLinks(): AuthLinks {
  const { status } = useSession();
  return useMemo(() => authLinks(status), [status]);
}
