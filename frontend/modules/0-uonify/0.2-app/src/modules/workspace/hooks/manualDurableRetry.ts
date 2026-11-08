import { useComposerStore, type ProductLinkDraft } from './composerStore';
import { useWorkspaceStore } from './workspaceStore';

/** Solo se reutiliza después de comprobar que el servidor no reservó el intento. */
export interface ManualDurableRetry {
  account: string;
  epoch: number;
  threadId: string;
  text: string;
  requestId: string;
  body: Record<string, unknown>;
}

export const MANUAL_RETRY_STATUS = 'No encontramos esta petición en curso. Conservamos tu texto; si pulsas Enviar, consultaremos el mismo intento.';

const retries = new Map<string, ManualDurableRetry>();
const drafts = new Map<string, string>();
const productLinks = new Map<string, ProductLinkDraft>();
const scopedDrafts = new Set<string>();
const deferredThreads = new Map<string, { account: string; epoch: number; threadId: string }>();
const keyOf = (account: string, epoch: number, threadId: string) => JSON.stringify([account, epoch, threadId]);

export function manualDurableRetriesFor(account: string, epoch: number): ManualDurableRetry[] {
  return [...retries.values()].filter(retry => retry.account === account && retry.epoch === epoch);
}

export function deferredThreadIdsFor(account: string, epoch: number): string[] {
  return [...deferredThreads.values()].filter(item => item.account === account && item.epoch === epoch)
    .map(item => item.threadId);
}

/** Un rechazo definitivo permite redactar de nuevo, pero no reutiliza el UUID del POST. */
export function rememberScopedDraft(account: string, epoch: number, threadId: string, text: string,
  productLink: ProductLinkDraft | null = null): void {
  const key = keyOf(account, epoch, threadId);
  scopedDrafts.add(key);
  drafts.set(key, text);
  if (productLink) productLinks.set(key, productLink);
  else productLinks.delete(key);
}

export function rememberThreadDraft(account: string, epoch: number, threadId: string, text: string,
  productLink: ProductLinkDraft | null = null): void {
  const key = keyOf(account, epoch, threadId);
  rememberScopedDraft(account, epoch, threadId, text, productLink);
  deferredThreads.set(key, { account, epoch, threadId });
}

export function consumeThreadDraft(account: string, epoch: number, threadId: string, text: string): void {
  const key = keyOf(account, epoch, threadId);
  deferredThreads.delete(key);
  if (drafts.get(key) === text) drafts.delete(key);
  productLinks.delete(key);
}

export function manualDurableRetryOf(account: string, epoch: number, threadId: string | null, text: string): ManualDurableRetry | null {
  if (!threadId) return null;
  const retry = retries.get(keyOf(account, epoch, threadId));
  return retry?.text === text ? retry : null;
}

export function rememberManualDurableRetry(retry: ManualDurableRetry): void {
  const key = keyOf(retry.account, retry.epoch, retry.threadId);
  retries.set(key, retry);
  scopedDrafts.add(key);
}

export function forgetManualDurableRetry(account: string, epoch: number, threadId: string, requestId: string): void {
  const key = keyOf(account, epoch, threadId);
  if (retries.get(key)?.requestId === requestId) {
    const original = retries.get(key)?.text;
    retries.delete(key);
    if (drafts.get(key) === original) drafts.delete(key);
  }
}

useWorkspaceStore.subscribe((state, previous) => {
  if (state.historyEpoch !== previous.historyEpoch || state.historyAccount !== previous.historyAccount) {
    retries.clear(); drafts.clear(); productLinks.clear(); scopedDrafts.clear(); deferredThreads.clear(); return;
  }
  if (state.threads !== previous.threads) {
    const ids = new Set(state.threads.map(thread => thread.id));
    retries.forEach((retry, key) => { if (retry.account === state.historyAccount && retry.epoch === state.historyEpoch
      && !ids.has(retry.threadId)) retries.delete(key); });
    const removed = new Set(previous.threads.filter(thread => !ids.has(thread.id)).map(thread => thread.id));
    removed.forEach(id => {
      const key = keyOf(state.historyAccount ?? '', state.historyEpoch, id);
      drafts.delete(key); productLinks.delete(key); scopedDrafts.delete(key); deferredThreads.delete(key);
    });
  }
  if (state.activeThreadId === previous.activeThreadId || !state.historyAccount) return;
  const previousKey = previous.activeThreadId ? keyOf(state.historyAccount, state.historyEpoch, previous.activeThreadId) : null;
  const nextKey = state.activeThreadId ? keyOf(state.historyAccount, state.historyEpoch, state.activeThreadId) : null;
  if (!((previousKey && scopedDrafts.has(previousKey)) || (nextKey && scopedDrafts.has(nextKey)))) return;
  const composer = useComposerStore.getState();
  if (previousKey && state.threads.some(thread => thread.id === previous.activeThreadId)) {
    rememberScopedDraft(state.historyAccount, state.historyEpoch, previous.activeThreadId!, composer.draft, composer.productLink);
  }
  if (nextKey) {
    scopedDrafts.add(nextKey);
    const link = productLinks.get(nextKey);
    if (link) composer.prepareProductLink(link);
    else composer.setDraft(drafts.get(nextKey) || retries.get(nextKey)?.text || '');
  }
  else composer.setDraft('');
});

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => {
  retries.clear(); drafts.clear(); productLinks.clear(); scopedDrafts.clear(); deferredThreads.clear();
});
