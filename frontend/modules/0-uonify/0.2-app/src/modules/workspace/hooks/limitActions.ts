import { queryClient } from '@/shared/api/queryClient';
import { blockedByLimit, type LimitReason } from '../model/aiLimit';
import type { UsageData } from '../model/usage';
import { closeAccountMenu } from './actions';
import { useComposerStore } from './composerStore';
import { setUi, useUiStore } from './uiStore';

/**
 * Límite del plan de ChatGPT: el uso compartido en caché (el anillo del compositor,
 * el aviso y el motor de la conversación leen lo mismo) y el aviso que deja elegir.
 */
export const USAGE_QUERY_KEY = ['workspace', 'ai-usage'] as const;

export function usageSnapshot(): UsageData | undefined {
  return queryClient.getQueryData<UsageData>(USAGE_QUERY_KEY);
}

export function setUsageSnapshot(usage: UsageData): void {
  queryClient.setQueryData(USAGE_QUERY_KEY, usage);
}

/** El servidor rechazó un mensaje por el límite: el uso lo dice aunque la caché no lo supiera. */
export function markLimitReached(): void {
  queryClient.setQueryData<UsageData>(USAGE_QUERY_KEY, current => ({ ...(current ?? {}), limitReached: true, payer: 'chatgpt' }));
  void queryClient.invalidateQueries({ queryKey: USAGE_QUERY_KEY });
}

/** Con el plan de ChatGPT agotado, Uony no recibe nada hasta que el cliente elija. */
export function limitBlocksSending(): boolean {
  return blockedByLimit(usageSnapshot());
}

export function openLimitDialog(reason: LimitReason): void {
  closeAccountMenu();
  useComposerStore.getState().setUsageOpen(false);
  if (useUiStore.getState().limitDialog === null) setUi({ limitDialog: reason });
}

export function closeLimitDialog(): void {
  setUi({ limitDialog: null });
}
