import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail } from '@/modules/auth';
import { ApiError } from '@/shared/api/client';
import { syncGoogleBilling, type BillingCloudConnection, type GoogleBillingSnapshot } from '../api/googleBilling';
import { verifiedGoogleSync } from '../model/googleBilling';

const QUERY = ['uony-google-billing'] as const;
const UNAVAILABLE = 'No hemos podido actualizar el consumo de Google. Puedes volver a consultarlo.';

/** El GET no crea informes; continuar el informe guardado usa una operación explícita y acotada. */
export function useGoogleBillingSync(active: boolean, response: GoogleBillingSnapshot | undefined) {
  const client = useQueryClient();
  const account = response?.accountEmail ?? null;
  const project = response?.projectId ?? null;
  const billingAccount = response?.billingAccountName ?? null;
  const scope = JSON.stringify([account, project, billingAccount]);
  const state = verifiedGoogleSync(response);
  const controller = useRef<AbortController | null>(null);
  const attempted = useRef(new Set<string>());
  const [request, setRequest] = useState({ scope: '', busy: false, failed: false });
  const current = useCallback(() => {
    const connection = client.getQueryData<BillingCloudConnection>(['google-cloud', account]);
    return active && !!account && currentAccountEmail() === account && !!project && !!billingAccount
      && connection?.connection.status === 'connected' && connection.connection.projectId === project
      && connection.accessAllowed && (!connection.connection.email || connection.connection.email === account);
  }, [active, account, project, billingAccount, client]);
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: [...QUERY, account, project], exact: true }), [account, project, client]);
  const sync = useCallback(async (prepare = false) => {
    if (!current() || controller.current || response?.billingVerified !== true) return;
    const pending = new AbortController(); controller.current = pending;
    setRequest({ scope, busy: true, failed: false });
    try {
      const result = await syncGoogleBilling(prepare, pending.signal);
      if (pending.signal.aborted || !current()) return;
      if (result.accountEmail !== account || result.projectId !== project || result.billingAccountName !== billingAccount
        || result.sync.projectId !== project || result.sync.billingAccountName !== billingAccount) throw new Error('scope_changed');
      client.setQueryData<GoogleBillingSnapshot>([...QUERY, account, project], previous => previous
        && previous.accountEmail === account && previous.projectId === project && previous.billingAccountName === billingAccount
        ? { ...previous, sync: result.sync } : previous);
      await refresh();
    } catch (error) {
      if (pending.signal.aborted || !current()) return;
      const detail = error instanceof ApiError && error.data && typeof error.data === 'object'
        ? error.data as { error?: unknown } : null;
      const busy = error instanceof ApiError && error.status === 409 && detail?.error === 'billing_sync_busy';
      if (busy) await refresh();
      else setRequest({ scope, busy: false, failed: true });
    } finally {
      if (controller.current === pending) controller.current = null;
      setRequest(previous => previous.scope === scope ? { ...previous, busy: false } : previous);
    }
  }, [current, response?.billingVerified, scope, account, project, billingAccount, client, refresh]);
  useEffect(() => {
    const cancel = () => { controller.current?.abort(); controller.current = null; };
    window.addEventListener('uonify:identity-changed', cancel);
    return () => { cancel(); window.removeEventListener('uonify:identity-changed', cancel); };
  }, [scope, active]);
  const failed = request.scope === scope && request.failed;
  const syncing = request.scope === scope && request.busy;
  useEffect(() => {
    if (!active || !current() || response?.billingVerified !== true || !Object.hasOwn(response, 'sync')
      || (response.sync && !state)) return;
    const next = state?.nextCheckAt ? Date.parse(state.nextCheckAt) : null;
    if (state && !state.canSync) {
      if (next !== null && Number.isFinite(next)) {
        const delay = Math.min(2_147_483_647, Math.max(1000, next - Date.now()));
        const timer = window.setTimeout(() => { if (current()) void refresh(); }, delay);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    if (state?.status === 'error' || state?.status === 'needs_setup' || failed) return;
    const signature = JSON.stringify([scope, state?.status, state?.checkedAt, state?.nextCheckAt]);
    if (attempted.current.has(signature)) return;
    // El aplazamiento evita iniciar dos POST en el montaje de React StrictMode.
    const timer = window.setTimeout(() => {
      if (!current() || controller.current) return;
      attempted.current.add(signature);
      void sync(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, current, response, state, scope, failed, refresh, sync]);
  return { sync, syncing, syncError: failed ? UNAVAILABLE : null, syncState: state };
}
