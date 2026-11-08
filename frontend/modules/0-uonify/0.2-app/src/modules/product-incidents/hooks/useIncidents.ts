import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { errorMessage } from '@/shared/api/client';
import { getIncident, listIncidents, syncIncidents } from '../api/incidents';
import type { IncidentFilters } from '../model/types';

const subscribeIdentity = (listener: () => void) => {
  window.addEventListener('uonify:identity-changed', listener);
  return () => window.removeEventListener('uonify:identity-changed', listener);
};
export const incidentKeys = { all: ['product-incidents'] as const, account: (account: string | null) => ['product-incidents', account] as const };
export const useIncidentAccount = () => useSyncExternalStore(subscribeIdentity, currentAccountEmail, () => null);

export function useIncidents(filters: IncidentFilters = {}, enabled = true, watchPending = false) {
  const account = useIncidentAccount();
  const client = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [failure, setFailure] = useState<{ account: string | null; message: string } | null>(null);
  const busy = useRef(false);
  const automaticChecks = useRef(0);
  const query = useQuery({
    queryKey: [...incidentKeys.account(account), 'list', filters],
    queryFn: ({ signal }) => listIncidents(filters, signal),
    enabled: enabled && !!account, retry: false, staleTime: 15_000,
  });
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: incidentKeys.account(account) }); };
    const connectionChanged = (event: Event) => {
      if ((event as CustomEvent<{ account: string }>).detail?.account !== account || currentAccountEmail() !== account) return;
      // Otra cuenta de vendedor bajo la misma identidad no puede conservar la bandeja anterior.
      void client.resetQueries({ queryKey: incidentKeys.account(account) });
    };
    window.addEventListener('uonify:product-incidents-changed', refresh);
    window.addEventListener('uonify:amazon-connection-changed', connectionChanged);
    return () => {
      window.removeEventListener('uonify:product-incidents-changed', refresh);
      window.removeEventListener('uonify:amazon-connection-changed', connectionChanged);
    };
  }, [account, client]);
  const sync = async (cursor?: string, marketplaceId = filters.marketplaceId) => {
    if (!account || busy.current || currentAccountEmail() !== account) return;
    busy.current = true; setSyncing(true); setFailure(null);
    try {
      const result = await syncIncidents({ sku: filters.sku, marketplaceId }, cursor);
      if (currentAccountEmail() === account) {
        if (result.sync.state === 'error') setFailure({ account, message: result.sync.message || 'Amazon no ha podido confirmar el estado. Conservamos la última información conocida.' });
        await client.invalidateQueries({ queryKey: incidentKeys.account(account) });
      }
    } catch (error) {
      if (currentAccountEmail() === account) setFailure({ account, message: errorMessage(error, 'No se ha podido consultar Amazon. Las incidencias anteriores se conservan.') });
    } finally { busy.current = false; setSyncing(false); }
  };
  const currentSync = useRef(sync);
  useEffect(() => { currentSync.current = sync; });
  const pendingMarkets = [...new Set(query.data?.incidents.filter(item => item.status === 'awaiting_amazon').map(item => item.marketplaceId) ?? [])];
  const currentPendingMarkets = useRef(pendingMarkets);
  useEffect(() => { currentPendingMarkets.current = pendingMarkets; });
  const pending = pendingMarkets.length > 0;
  const canPoll = watchPending && enabled && pending && query.data?.connection.connected && query.data.sync.state !== 'partial';
  useEffect(() => {
    if (!canPoll || !account) return;
    // Solo lecturas de Amazon, con pausa al ocultar la vista o perder la conexión.
    // Cinco comprobaciones por apertura; después queda disponible el control manual.
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || busy.current || automaticChecks.current >= 5 || currentAccountEmail() !== account) return;
      const market = currentPendingMarkets.current[automaticChecks.current % currentPendingMarkets.current.length];
      automaticChecks.current += 1;
      void currentSync.current(undefined, market);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [account, canPoll]);
  return { query, sync, syncing, syncError: failure?.account === account ? failure.message : null, account };
}

export function useIncident(id: string | null) {
  const account = useIncidentAccount();
  return useQuery({ queryKey: [...incidentKeys.account(account), 'detail', id], queryFn: ({ signal }) => getIncident(id!, signal), enabled: !!account && !!id, retry: false });
}
