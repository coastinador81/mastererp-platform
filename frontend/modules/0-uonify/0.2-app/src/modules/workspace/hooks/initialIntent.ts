import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { acknowledgePendingPrompt, readPendingPrompt, currentAccountEmail, type FirstIntentDelivery } from '@/modules/auth';
import { api } from '@/shared/api/client';
import { noticeInConversation } from './conversationNotice';
import { USE_MOCKS } from '@/shared/api/config';
import { queryClient } from '@/shared/api/queryClient';
import { useComposerStore } from './composerStore';
import { googleSelectionEfforts, useGooglePreferences } from './googlePreferences';
import { sendLivePrompt } from './liveConversation';
import { useUiStore } from './uiStore';
import { useWorkspaceStore } from './workspaceStore';
import { historyKey, loadConversationHistory } from './liveHistory';

interface IntentState { firstIntent: string; firstIntentDelivery?: FirstIntentDelivery | null; persistFirstIntent?: boolean }
const key = (account: string, epoch = useWorkspaceStore.getState().historyEpoch) => ['uony-initial-intent', account, epoch] as const;
const attempted = new Set<string>();
const claiming = new Set<string>();
const retries = new Map<string, number>();
// Maqueta aprobada por el dueño (22-10-2026): si la petición guardada no se puede enviar, lo dice
// Uony en su conversación y la petición sigue en la caja para enviarla con el botón. Sin
// conversación todavía, el sistema reintenta solo y bajo la caja solo queda la espera.
const UNSENT = 'Tu petición está guardada, pero no he podido enviarla todavía. La tienes en la caja: pulsa enviar cuando quieras.';
const WAITING = 'Tu petición está guardada. Estamos preparando la conversación para continuar.';
const RETRY_MS = [5_000, 15_000, 30_000, 60_000, 60_000];
function unsent(client: QueryClient, account: string, threadId?: string | null): void {
  if (noticeInConversation(threadId, UNSENT)) { useComposerStore.getState().setStatus(''); return; }
  useComposerStore.getState().setStatus(WAITING);
  const tries = retries.get(account) ?? 0;
  if (tries >= RETRY_MS.length) return;
  retries.set(account, tries + 1);
  setTimeout(() => {
    const source = current(account) ? client.getQueryData<IntentState>(key(account)) : null;
    if (source?.firstIntent && !source.firstIntentDelivery) void deliver(client, account, source, source.firstIntent, true);
  }, RETRY_MS[tries]);
}
const current = (account: string) => currentAccountEmail() === account;
function selectionReady(account: string) {
  const selection = useGooglePreferences.getState();
  if (selection.account !== account || !selection.data || selection.saving) return false;
  const { model, effort } = selection.data.preferences;
  return googleSelectionEfforts(selection.data, model).includes(effort);
}

async function deliver(client: QueryClient, account: string, source: IntentState, text: string, automatic: boolean): Promise<true> {
  const epoch = useWorkspaceStore.getState().historyEpoch;
  const valid = () => current(account) && epoch === useWorkspaceStore.getState().historyEpoch;
  const claim = `${account}:${epoch}`;
  if (!valid() || claiming.has(claim)) return true;
  const composer = useComposerStore.getState();
  if (text.length > 3000) { composer.setStatus('Tu petición tiene más de 3000 caracteres. La conservamos completa; acórtala o divídela antes de enviarla.'); return true; }
  if (!selectionReady(account)) { composer.setStatus('Conservamos tu petición mientras preparamos la IA para enviarla.'); return true; }
  let delivery = source.firstIntentDelivery;
  if (delivery && delivery.status !== 'pending') {
    if (delivery.status !== 'complete') composer.setStatus(delivery.message);
    return true;
  }
  claiming.add(claim);
  try {
    if (!delivery) {
      if (source.persistFirstIntent || source.firstIntent !== text) await api.put('/onboarding/setup', { firstIntent: text }, { signal: AbortSignal.timeout(15_000) });
      if (!valid()) return true;
      const preferences = useGooglePreferences.getState().data!.preferences;
      const response = await api.post<{ delivery: FirstIntentDelivery | null }>('/onboarding/first-intent/claim', preferences, { signal: AbortSignal.timeout(30_000) });
      if (!valid()) return true;
      delivery = response.delivery;
      if (!delivery) { unsent(client, account); return true; }
      retries.delete(account);
      client.setQueryData<IntentState>(key(account, epoch), { firstIntent: delivery.text, firstIntentDelivery: delivery });
    }
    if (delivery.status !== 'pending' || (automatic && attempted.has(`${account}:${delivery.requestId}`))) return true;
    const preserveDraft = !!useComposerStore.getState().draft.trim() && useComposerStore.getState().draft.trim() !== delivery.text.trim();
    const accepted = sendLivePrompt(delivery.text, { initialIntent: delivery, preserveDraft, onSettled: () => {
      if (!valid()) return;
      void client.invalidateQueries({ queryKey: key(account) });
      void client.invalidateQueries({ queryKey: ['uony-threads', account] });
    } });
    if (accepted) {
      attempted.add(`${account}:${delivery.requestId}`);
      acknowledgePendingPrompt(delivery.text);
    }
  } catch { if (valid()) unsent(client, account, delivery?.threadId); }
  finally { claiming.delete(claim); }
  return true;
}

/** La edición manual previa a reservar la entrega actualiza también la intención original, sin truncarla. */
export function submitPendingFirstIntent(text: string): false | Promise<true> {
  const account = currentAccountEmail();
  const source = account ? queryClient.getQueryData<IntentState>(key(account)) : null;
  if (!account || !source?.firstIntent || source.firstIntentDelivery?.status === 'complete') return false;
  if (source.firstIntentDelivery && text !== source.firstIntentDelivery.text) return false;
  return deliver(queryClient, account, source, text, false);
}

/** Espera el historial y el catálogo reales; la copia local no acredita una entrega. */
export function useInitialIntent(account: string | null, onboardingEntry = false) {
  const client = useQueryClient();
  const selection = useGooglePreferences();
  const reconciled = useRef(new Set<string>());
  const completed = useRef(new Set<string>());
  const tracked = useRef(new Set<string>());
  const entrySelected = useRef(false);
  const threads = useWorkspaceStore(value => value.threads);
  const activeThreadId = useWorkspaceStore(value => value.activeThreadId);
  const draft = useComposerStore(state => state.draft);
  const pending = useUiStore(state => state.pendingReply);
  const epoch = useWorkspaceStore(state => state.historyEpoch);
  // La entrega también solicita el historial: no depende de que otro lector ya esté montado.
  const history = useQuery({ queryKey: historyKey(account, epoch), enabled: !USE_MOCKS && !!account && current(account),
    queryFn: ({ signal }) => loadConversationHistory(account, epoch, signal),
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const state = useQuery<IntentState>({ queryKey: key(account ?? '', epoch), enabled: !USE_MOCKS && !!account && current(account), retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    refetchInterval: query => query.state.data?.firstIntentDelivery?.status === 'sending' ? 2000 : false,
    queryFn: async ({ signal }) => {
      const result = await api.get<IntentState>('/onboarding/setup', { signal });
      if (!account || !current(account) || epoch !== useWorkspaceStore.getState().historyEpoch || signal.aborted) throw new DOMException('Tu cuenta ha cambiado.', 'AbortError');
      if (!result.firstIntent && !result.firstIntentDelivery) {
        const local = readPendingPrompt();
        if (local) return { ...result, firstIntent: local, persistFirstIntent: true };
      }
      return result;
    },
  });
  useEffect(() => {
    if (USE_MOCKS || !account || !current(account) || !state.data || state.isError || state.isFetching) return;
    const source = state.data;
    if (!source.firstIntent) {
      if (onboardingEntry && !entrySelected.current && history.data && !history.isFetching && !history.isError) {
        entrySelected.current = true;
        useWorkspaceStore.getState().setActiveThread(null);
      }
      return;
    }
    const delivery = source.firstIntentDelivery;
    if (onboardingEntry && !entrySelected.current && delivery && history.data && !history.isFetching && !history.isError && threads.some(thread => thread.id === delivery.threadId)) {
      entrySelected.current = true;
      useWorkspaceStore.getState().setActiveThread(delivery.threadId);
    }
    if (delivery?.status === 'complete') {
      const request = `${account}:${delivery.requestId}`;
      const composer = useComposerStore.getState();
      if (!pending && attempted.has(request) && !completed.current.has(request)) {
        completed.current.add(request);
        if (composer.draft.trim() === delivery.text.trim()) composer.setDraft('');
        composer.setStatus('');
      }
      const local = readPendingPrompt();
      if (local && local !== delivery.text && !useComposerStore.getState().draft.trim()) composer.setDraft(local);
      if (!pending && tracked.current.has(request) && !completed.current.has(`active:${request}`) && threads.some(thread => thread.id === delivery.threadId)) {
        completed.current.add(`active:${request}`);
        if (!activeThreadId) useWorkspaceStore.getState().setActiveThread(delivery.threadId);
      }
      // La respuesta puede terminar en el servidor después de perder la conexión local.
      const inHistory = history.data?.threads.some(thread => thread.id === delivery.threadId && thread.messages.some(message => message.role === 'assistant'));
      if (history.data && !history.isFetching && !history.isError && !inHistory && !reconciled.current.has(request)) {
        reconciled.current.add(request);
        void client.invalidateQueries({ queryKey: ['uony-threads', account] });
      }
      return;
    }
    if (delivery) tracked.current.add(`${account}:${delivery.requestId}`);
    if (pending || (delivery?.status === 'pending' && attempted.has(`${account}:${delivery.requestId}`))) return;
    const text = delivery?.text ?? source.firstIntent;
    const composer = useComposerStore.getState();
    if (!composer.draft.trim()) composer.setDraft(text);
    if (text.length > 3000) { composer.setStatus('Tu petición tiene más de 3000 caracteres. La conservamos completa; acórtala o divídela antes de enviarla.'); return; }
    if (delivery && delivery.status !== 'pending') { composer.setStatus(delivery.message); return; }
    if (!history.data || history.isFetching || history.isError || !selectionReady(account)) { composer.setStatus('Tu petición está guardada. Estamos preparando la conversación para continuar.'); return; }
    void deliver(client, account, source, text, true);
  }, [account, client, state.data, state.isError, state.isFetching, history.data, history.isFetching, history.isError, selection, pending, draft, threads, activeThreadId, onboardingEntry, epoch]);
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => { attempted.clear(); claiming.clear(); retries.clear(); });
