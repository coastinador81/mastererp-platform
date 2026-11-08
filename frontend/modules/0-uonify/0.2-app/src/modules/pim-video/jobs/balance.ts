import { create } from 'zustand';
import { getBalance } from '../api/videoApi';
import { currencyOf } from '../model/format';

/**
 * Saldo del cliente (GET /billing/balance), compartido por las fichas
 * (prototipo: pim/video.js, `balance` y refreshBalance). Se consulta como mucho
 * una vez por minuto salvo que se fuerce (tras generar o rehacer un plano).
 */
export type BalanceStatus = 'idle' | 'loading' | 'ok' | 'unavailable';

export interface BalanceState {
  state: BalanceStatus;
  amount: number;
  currency: string;
  at: number;
}

export const useBalanceStore = create<BalanceState>(() => ({ state: 'idle', amount: 0, currency: 'EUR', at: 0 }));

let pending: Promise<void> | null = null;

export function refreshBalance(force = false): Promise<void> {
  if (pending) return pending;
  const current = useBalanceStore.getState();
  if (!force && current.state !== 'idle' && Date.now() - current.at < 60000) return Promise.resolve();
  useBalanceStore.setState({ state: current.state === 'ok' ? 'ok' : 'loading' });
  pending = getBalance()
    .then(data => {
      const amount = Number(data?.amount ?? data?.balance);
      const currency = currencyOf(data?.currency || 'EUR');
      if (data?.amount === null || !Number.isFinite(amount) || !currency) throw new Error('Saldo no disponible');
      useBalanceStore.setState({ state: 'ok', amount, currency });
    })
    .catch(() => {
      useBalanceStore.setState({ state: 'unavailable' });
    })
    .finally(() => {
      useBalanceStore.setState({ at: Date.now() });
      pending = null;
    });
  return pending;
}

/** Saldo conocido y agotado. */
export const noBalanceIn = (balance: Pick<BalanceState, 'state' | 'amount'>): boolean => balance.state === 'ok' && balance.amount <= 0;
export const noBalance = (): boolean => noBalanceIn(useBalanceStore.getState());

/** Vuelve al estado inicial (pruebas). */
export function resetBalance(): void {
  pending = null;
  useBalanceStore.setState({ state: 'idle', amount: 0, currency: 'EUR', at: 0 });
}
