import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail, useSession } from '@/modules/auth';
import { getBillingCloudConnection, getGoogleBilling } from '../api/googleBilling';
import { verifiedGoogleBillingLinks, verifiedGoogleSnapshot } from '../model/googleBilling';
import { useGoogleBillingSync } from './useGoogleBillingSync';

export const GOOGLE_BILLING_QUERY_KEY = ['uony-google-billing'] as const;

/** La conexión determina el ámbito; una consulta nueva nunca cambia la fecha del dinero observado. */
export function useGoogleBilling(active: boolean) {
  const client = useQueryClient();
  const { user } = useSession();
  const account = user?.email ?? null;
  const sameAccount = !!account && account === currentAccountEmail();
  const connection = useQuery({
    queryKey: ['google-cloud', account], queryFn: ({ signal }) => getBillingCloudConnection(signal),
    enabled: active && sameAccount, retry: false, staleTime: 0, gcTime: 60_000,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const scopeReady = sameAccount && !!connection.data && !connection.isError && !connection.isFetching;
  const project = scopeReady ? connection.data?.connection.projectId ?? null : null;
  const connected = scopeReady && connection.data?.connection.status === 'connected' && connection.data.accessAllowed
    && (!connection.data.connection.email || connection.data.connection.email === account);
  const billing = useQuery({
    queryKey: [...GOOGLE_BILLING_QUERY_KEY, account, project],
    queryFn: ({ signal }) => getGoogleBilling(signal),
    enabled: active && connected && !!project,
    retry: false, staleTime: 0, gcTime: 60_000,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  useEffect(() => {
    const clear = () => {
      void client.cancelQueries({ queryKey: GOOGLE_BILLING_QUERY_KEY });
      client.removeQueries({ queryKey: GOOGLE_BILLING_QUERY_KEY });
    };
    window.addEventListener('uonify:identity-changed', clear);
    return () => window.removeEventListener('uonify:identity-changed', clear);
  }, [client]);
  const boundResponse = connected && project && !billing.isError
    && billing.data?.accountEmail === account && billing.data.projectId === project ? billing.data : undefined;
  const synchronization = useGoogleBillingSync(active && !!connected, boundResponse);
  const response = !billing.isFetching ? boundResponse : undefined;
  const snapshot = verifiedGoogleSnapshot(response);
  const loading = active && sameAccount && (connection.isFetching || connection.isPending
    || (connected && !!project && (billing.isPending || billing.isFetching)));
  const message = !sameAccount ? 'Recupera tu sesión para consultar Google.' : loading ? 'Consultando tus datos de Google…'
    : connection.isError ? 'No podemos comprobar tu conexión con Google ahora.'
      : !connected || !project ? 'Conecta Google Cloud y elige un proyecto para consultar estos datos.'
        : billing.isError ? 'No hemos podido recuperar los datos comprobados de Google.'
          : response?.message ?? 'Todavía no hay importes comprobados para esta cuenta y proyecto.';
  const retry = async () => {
    if (!active || !sameAccount) return;
    const updated = await connection.refetch();
    if (currentAccountEmail() !== account || updated.isError) return;
    await client.invalidateQueries({ queryKey: [...GOOGLE_BILLING_QUERY_KEY, account] });
  };
  // Releer metadatos no crea un saldo. El caso sin observación ofrece la
  // consulta oficial, y reserva el reintento para un fallo recuperable.
  const canRetry = active && sameAccount && !loading && (connection.isError || billing.isError
    || !response || ['google_unavailable', 'connection_changed', 'invalid_response'].includes(response.reason ?? ''));
  return { snapshot, loading, message, retry, canRetry, response, ...synchronization, consoleLinks: verifiedGoogleBillingLinks(response),
    account, projectName: connection.data?.connection.projectName };
}
