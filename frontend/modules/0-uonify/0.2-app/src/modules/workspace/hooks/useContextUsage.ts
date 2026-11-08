import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { currentAccountEmail, useSession } from '@/modules/auth';
import { activeProductContext } from '@/shared/pim';
import { measureContext, type ContextRequest } from '../api/contextUsage';
import { contextSummary } from '../model/contextUsage';
import { useComposerStore } from './composerStore';
import { useGooglePreferences } from './googlePreferences';
import { useUiStore } from './uiStore';
import { activeThreadOf, useWorkspaceStore } from './workspaceStore';

export const CONTEXT_QUERY_KEY = ['uony-context'] as const;

function subscribeProduct(refresh: () => void) {
  window.addEventListener('uonify:products-changed', refresh);
  window.addEventListener('uonify:active-product-changed', refresh);
  return () => {
    window.removeEventListener('uonify:products-changed', refresh);
    window.removeEventListener('uonify:active-product-changed', refresh);
  };
}
const productSnapshot = () => JSON.stringify(activeProductContext());

export function useContextUsage() {
  const client = useQueryClient();
  const { user } = useSession();
  const account = user?.email ?? null;
  const selection = useGooglePreferences();
  const draft = useComposerStore(state => state.draft);
  const thread = useWorkspaceStore(activeThreadOf);
  const pending = useUiStore(state => Boolean(state.pendingReply));
  const productSignature = useSyncExternalStore(subscribeProduct, productSnapshot, () => 'null');
  useEffect(() => {
    const clear = () => {
      void client.cancelQueries({ queryKey: CONTEXT_QUERY_KEY });
      client.removeQueries({ queryKey: CONTEXT_QUERY_KEY });
    };
    window.addEventListener('uonify:identity-changed', clear);
    return () => window.removeEventListener('uonify:identity-changed', clear);
  }, [client]);
  const product: ContextRequest['productContext'] = JSON.parse(productSignature);
  const preferences = selection.account === account ? selection.data?.preferences : undefined;
  const body: ContextRequest = { threadId: thread?.id ?? null, text: draft.trim(),
    model: preferences?.model ?? 'auto', effort: preferences?.effort ?? 'medium',
    projectId: thread?.projectId ?? null, productContext: product };
  // La firma contiene solo el estado local: nunca se guarda en almacenamiento del navegador.
  const models = selection.account === account ? selection.data?.models.map(model => [model.id, model.efforts]) : [];
  const signature = JSON.stringify([account, body, models, thread?.messages.length ?? 0, thread?.messages.slice(-24) ?? []]);
  const [settled, setSettled] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(signature), 400);
    return () => window.clearTimeout(timer);
  }, [signature]);
  const available = !!account && account === currentAccountEmail() && !!preferences
    && !selection.saving && !!selection.data?.models.length;
  const stable = signature === settled;
  const query = useQuery({
    queryKey: [...CONTEXT_QUERY_KEY, account, signature],
    queryFn: ({ signal }) => measureContext(body, signal),
    enabled: available && stable && !pending,
    retry: false, staleTime: 30_000, gcTime: 60_000,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  // Una respuesta de otra selección o de antes de escribir nunca representa la próxima entrada.
  const data = available && stable && !pending && !query.isError && !query.isFetching ? query.data : undefined;
  const summary = contextSummary(data);
  const loading = available && (!stable || query.isFetching || (query.isPending && !pending));
  return { data, summary, loading, pending, canRetry: available && stable && !pending,
    message: pending ? 'El contexto se actualizará cuando Uony termine.' :
      !available ? 'Elige una IA conectada para consultar el contexto.' :
      loading ? 'Midiendo el contexto…' :
      data?.message ?? 'No se ha podido medir el contexto. Inténtalo de nuevo.',
    retry: () => { if (available && stable && !pending) void query.refetch(); } };
}
