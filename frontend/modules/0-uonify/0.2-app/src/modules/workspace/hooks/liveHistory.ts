import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { USE_MOCKS } from '@/shared/api/config';
import { currentAccountEmail, useSession } from '@/modules/auth';
import { focusComposer, setChatPanel } from './actions';
import { useWorkspaceStore } from './workspaceStore';
import { useComposerStore } from './composerStore';
import { useUiStore } from './uiStore';
import { connectionActionsOf } from '../model/connectionActions';
import { conversationFormOf } from '../model/conversationForm';
import { materialAnalysisOf } from '../model/materialAnalysis';
import { productIntakeOf } from '../model/productIntake';
import { productProposalForThread } from '../model/productProposal';
import type { ChatMessage, Thread } from '../model/workspaceState';
import { deferredThreadIdsFor, forgetManualDurableRetry, MANUAL_RETRY_STATUS, manualDurableRetriesFor } from './manualDurableRetry';

export interface HistorySnapshot { threads: Thread[]; account: string; epoch: number; revision: number }
export const historyKey = (account: string | null, epoch: number) => ['uony-threads', account, epoch] as const;
export const HISTORY_ERROR = 'No hemos podido recuperar tus conversaciones. Tu mensaje se conserva; vuelve a pulsar Enviar para consultar el historial.';
export const HISTORY_WAIT = 'Estamos recuperando tu conversación. Tu mensaje se conserva.';

/** Un GET de fondo no descarta un borrador local ni un intento que espera reenvío manual. */
export function reconcileUnsentLocalThreads(server: Thread[], local: Thread[], account: string, epoch: number,
  pendingLiveThreadIds: readonly string[] = []): Thread[] {
  const threads = [...server];
  for (const id of new Set([...deferredThreadIdsFor(account, epoch), ...pendingLiveThreadIds])) {
    if (threads.some(thread => thread.id === id)) continue;
    const previous = local.find(thread => thread.id === id);
    if (previous) threads.push(previous);
  }
  for (const retry of manualDurableRetriesFor(account, epoch)) {
    const previous = local.find(thread => thread.id === retry.threadId);
    if (!previous) continue;
    const index = threads.findIndex(thread => thread.id === retry.threadId);
    const found = index < 0 ? null : threads[index];
    if (found?.messages.some(message => message.requestId === retry.requestId && message.role === 'assistant')) {
      const composer = useComposerStore.getState();
      if (composer.threadStatuses[retry.threadId] === MANUAL_RETRY_STATUS) composer.clearThreadStatus(retry.threadId);
      if (useWorkspaceStore.getState().activeThreadId === retry.threadId && composer.draft === retry.text) composer.setDraft('');
      forgetManualDurableRetry(account, epoch, retry.threadId, retry.requestId);
      continue;
    }
    const optimistic = previous.messages.find(message => message.requestId === retry.requestId && message.role === 'user');
    const message: ChatMessage = optimistic ?? { role: 'user', requestId: retry.requestId, text: retry.text,
      model: typeof retry.body.model === 'string' ? retry.body.model : undefined,
      effort: typeof retry.body.effort === 'string' ? retry.body.effort : undefined };
    if (!found) threads.push({ ...previous, messages: optimistic ? previous.messages : [...previous.messages, message] });
    else if (!found.messages.some(item => item.requestId === retry.requestId)) {
      threads[index] = { ...found, messages: [...found.messages, message] };
    }
  }
  return threads;
}

/** Todos los lectores comparten la misma cuenta, sesión y revisión local de partida. */
export async function loadConversationHistory(account: string | null, epoch: number, signal: AbortSignal): Promise<HistorySnapshot> {
  const valid = () => !!account && account === currentAccountEmail() && epoch === useWorkspaceStore.getState().historyEpoch && !signal.aborted;
  if (!valid()) throw new DOMException('Tu cuenta ha cambiado.', 'AbortError');
  const revision = useWorkspaceStore.getState().historyRevision;
  const result = await api.get<{ threads: Thread[] }>('/uony/threads', { signal });
  if (!valid()) throw new DOMException('Tu cuenta ha cambiado.', 'AbortError');
  if (!result || !Array.isArray(result.threads) || result.threads.some(thread => !thread || typeof thread.id !== 'string'
    || !Array.isArray(thread.messages) || thread.messages.some(message => !message || typeof message.text !== 'string'
      || !['user', 'assistant'].includes(message.role)))) throw new Error('El historial no ha respondido correctamente.');
  return { ...result, account: account!, epoch, revision };
}

export function useLiveHistory() {
  const client = useQueryClient();
  const { status, user } = useSession();
  const account = status === 'ready' ? user?.email ?? null : null;
  const epoch = useWorkspaceStore(state => state.historyEpoch);
  const owner = useWorkspaceStore(state => state.historyAccount);
  const pending = useUiStore(state => state.pendingReply);
  const recovering = useRef<HistorySnapshot | null>(null);
  useEffect(() => {
    const prompt = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      const link = typeof detail === 'object' && detail !== null && 'productLink' in detail
        ? detail as { text?: unknown; productLink?: { sku?: unknown; revision?: unknown } } : null;
      const account = currentAccountEmail();
      if (link && typeof link.text === 'string' && account && typeof link.productLink?.sku === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(link.productLink.sku)
        && typeof link.productLink.revision === 'number' && Number.isSafeInteger(link.productLink.revision)
        && link.productLink.revision >= 1) {
        useComposerStore.getState().prepareProductLink({ text: link.text, sku: link.productLink.sku,
          revision: link.productLink.revision, account,
          threadId: useWorkspaceStore.getState().activeThreadId });
      } else if (typeof detail === 'string') useComposerStore.getState().setDraft(detail);
      setChatPanel(true); focusComposer();
    };
    const refresh = () => { void client.invalidateQueries({ queryKey: ['catalog'] }); };
    window.addEventListener('uonify:product-prompt', prompt);
    window.addEventListener('uonify:products-changed', refresh);
    return () => { window.removeEventListener('uonify:product-prompt', prompt); window.removeEventListener('uonify:products-changed', refresh); };
  }, [client]);
  const history = useQuery({ queryKey: historyKey(account, epoch),
    queryFn: ({ signal }) => loadConversationHistory(account, epoch, signal),
    enabled: !USE_MOCKS && !!account && account === currentAccountEmail(), retry: false, staleTime: 0,
    refetchOnWindowFocus: false, refetchOnReconnect: false });
  useEffect(() => {
    if (USE_MOCKS || !account || account !== currentAccountEmail()) return;
    const retry = () => { void client.refetchQueries({ queryKey: historyKey(account, epoch), exact: true }); };
    useWorkspaceStore.setState({ retryHistory: retry });
    return () => {
      if (useWorkspaceStore.getState().retryHistory === retry) useWorkspaceStore.setState({ retryHistory: null });
    };
  }, [account, epoch, client]);
  useEffect(() => {
    if (USE_MOCKS || !account || account !== currentAccountEmail() || epoch !== useWorkspaceStore.getState().historyEpoch) return;
    // Una actualización de fondo no revoca un historial ya aplicado a esta identidad.
    useWorkspaceStore.setState({ historyLoading: history.isFetching, historyError: history.isError });
    if (history.isFetching) return;
    const store = useWorkspaceStore.getState();
    if (history.isError) return;  // Lote 6: no error under the composer; sending retries it (HISTORY_WAIT).
    const snapshot = history.data;
    if (!snapshot || snapshot.account !== account || snapshot.epoch !== epoch
      || (store.historyAccount === account && store.historySnapshot === snapshot)) return;
    // Un GET iniciado antes de un envío no puede borrar sus mensajes, aunque llegue después del POST.
    if (pending || snapshot.revision !== store.historyRevision) {
      if (!pending && recovering.current !== snapshot) {
        recovering.current = snapshot;
        void client.invalidateQueries({ queryKey: historyKey(account, epoch), exact: true });
      }
      return;
    }
    const sameAccount = store.historyAccount === account;
    const canonical = snapshot.threads.map(thread => ({ ...thread, messages: thread.messages.map(message => ({
      ...message, connectionActions: connectionActionsOf(message.connectionActions, message.role),
      conversationForm: conversationFormOf(message.conversationForm, message.role),
      materialAnalysis: materialAnalysisOf(message.materialAnalysis, message.role), conversationFormFresh: false,
      productIntake: productIntakeOf(message.productIntake, message.role),
      productProposal: productProposalForThread(message.productProposal, message.role, thread.id),
    })) }));
    const threads = sameAccount ? reconcileUnsentLocalThreads(canonical, store.threads, account, epoch,
      store.pendingLiveThreadIds) : canonical;
    const active = sameAccount ? threads.find(thread => thread.id === store.activeThreadId) : threads.at(-1);
    const confirmed = new Set(canonical.map(thread => thread.id));
    useWorkspaceStore.setState({ threads, historyAccount: account, historyLoading: false, historyError: false,
      historySnapshot: snapshot,
      pendingLiveThreadIds: store.pendingLiveThreadIds.filter(id => !confirmed.has(id)),
      boundLiveThreadIds: store.boundLiveThreadIds.filter(id => !confirmed.has(id)),
      activeThreadId: active?.id ?? null, activeProjectId: active?.projectId ?? (sameAccount ? store.activeProjectId : null) });
    const composer = useComposerStore.getState();
    if ([HISTORY_ERROR, HISTORY_WAIT, 'Estamos recuperando tu conversación. Inténtalo en un momento.'].includes(composer.status)) composer.setStatus('');
  }, [history.data, history.isFetching, history.isError, account, epoch, owner, pending, client]);
}
