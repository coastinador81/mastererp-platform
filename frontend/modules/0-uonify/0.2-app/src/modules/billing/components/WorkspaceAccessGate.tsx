import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AccountDeletionControl, ConversationActivationAccess, signOut, useAccessTransition, useSession } from '@/modules/auth';
import { Alert, Button, Spinner } from '@/shared/ui';
import { USE_MOCKS } from '@/shared/api/config';
import { billingApi } from '../api/billingApi';
import { CheckoutDialog } from './checkout/CheckoutDialog';

/** No monta servicios ni sus efectos hasta que el servidor permite el acceso. */
export function WorkspaceAccessGate({ children }: { children: ReactNode }) {
  const session = useSession();
  return <AccessForAccount key={session.user?.email ?? ''} session={session}>{children}</AccessForAccount>;
}

function AccessForAccount({ children, session }: { children: ReactNode; session: ReturnType<typeof useSession> }) {
  const { status, user, accountDeletionPending } = session;
  const [activationOpen, setActivationOpen] = useState(false);
  const transitionOpen = useAccessTransition();
  const access = useQuery({
    // Separada de billing: mantiene el recibo hasta «Listo» tras el pago.
    queryKey: ['workspace-access', user?.email],
    queryFn: async () => {
      const result = await billingApi.workspaceAccess();
      if (!USE_MOCKS && ['onboarding_required', 'subscription_required', 'checkout_required'].includes(result.status)) setActivationOpen(true);
      return result;
    },
    enabled: status === 'ready' && !accountDeletionPending,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const needsActivation = !!access.data && ['onboarding_required', 'subscription_required', 'checkout_required'].includes(access.data.status);
  const finishActivation = async () => {
    const result = await access.refetch({ throwOnError: true });
    if (result.data?.status === 'allowed') setActivationOpen(false);
  };
  if (accountDeletionPending && user) return <main className="bil-access">
    <Alert title="La eliminación de tu cuenta está pendiente">Consulta el estado y vuelve a intentarlo para completar la eliminación. Tu cuenta y tus datos se conservan hasta que podamos confirmarla.</Alert>
    <AccountDeletionControl account={user.email} />
    <Button onClick={() => void signOut()}>Cerrar sesión</Button>
  </main>;
  if (status !== 'ready' || (!activationOpen && (access.isPending || access.isFetching))) return <Spinner label="Preparando tu espacio…" />;
  if (!activationOpen && (access.isError || !access.data || !['allowed', 'checkout_required', 'onboarding_required', 'subscription_required'].includes(access.data.status))) {
    return <main className="bil-access">
      <Alert tone="red" title="No se ha podido comprobar tu acceso">Vuelve a intentarlo para continuar.</Alert>
      <Button variant="primary" onClick={() => void access.refetch()}>Reintentar</Button>
      <Button onClick={() => void signOut()}>Cerrar sesión</Button>
    </main>;
  }
  // El prototipo MSW conserva su contrato de demostración; nunca respalda una API real.
  if (USE_MOCKS && access.data?.status === 'checkout_required') {
    if (transitionOpen) return <Spinner label="Cargando pasarela de pago…" />;
    return <CheckoutDialog required planId={access.data.planId} interval={access.data.interval} onComplete={() => void access.refetch()} />;
  }
  // Confirmar el acceso en segundo plano no retira el recibo ni el cierre que se están leyendo.
  if (activationOpen || needsActivation) return <ConversationActivationAccess account={user?.email ?? ''} onFinished={finishActivation} />;
  return children;
}
