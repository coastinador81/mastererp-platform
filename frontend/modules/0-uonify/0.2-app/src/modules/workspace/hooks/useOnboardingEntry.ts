import { useId, useLayoutEffect, useSyncExternalStore } from 'react';
import { playEnter } from '../model/motion';
import { onboardingEntrySnapshot, subscribeOnboardingEntry, takeOnboardingEntry } from '../model/onboardingEntry';
import { announce, workspaceRefs } from './uiStore';

/** La entrada desde el cierre aprobado conserva el marco y solo lo funde suavemente. */
export function useOnboardingEntry(account: string | null): boolean {
  const consumer = useId();
  const entry = useSyncExternalStore(subscribeOnboardingEntry, onboardingEntrySnapshot, () => null);
  useLayoutEffect(() => {
    if (!account || !entry || entry.consumer !== null) return;
    if (!takeOnboardingEntry(account, consumer)) return;
    playEnter(workspaceRefs.column, 'uon-enter-soft');
    workspaceRefs.workspace?.focus({ preventScroll: true });
    announce('Bienvenido a tu espacio de Uonify. Continuamos con Uony.');
  }, [account, consumer, entry]);
  return !!account && entry?.account === account && entry.consumer === consumer;
}
