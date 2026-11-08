import { create } from 'zustand';
import type { PlanRequiredDetail } from '@/shared/api/planRequired';
import type { BillingInterval, PlanId } from '../model/plans';

/**
 * Diálogos de facturación: los pinta <PaywallHost/> (montado una vez en
 * AppProviders) dentro del proveedor de datos. Solo hay uno abierto a la vez: al
 * pasar del muro de pago al pago, el primero se cierra y el foco vuelve a quien
 * abrió el aviso antes de entrar en el siguiente.
 */
export type BillingDialog =
  | { kind: 'checkout'; planId: PlanId; interval?: BillingInterval }
  | { kind: 'recharge' }
  | { kind: 'withdrawal' }
  | { kind: 'support' }
  | { kind: 'payment-method' }
  | { kind: 'paywall'; detail: PlanRequiredDetail };

export type DialogOutcome = 'done' | 'cancelled';

interface DialogsState {
  current: (BillingDialog & { id: number }) | null;
  /** <PaywallHost/> montados (sin anfitrión no se puede abrir nada). */
  hosts: number;
  /** Si el cliente tiene ChatGPT conectado (null: no se sabe). */
  chatGptConnected: boolean | null;
}

export const useBillingDialogs = create<DialogsState>(() => ({ current: null, hosts: 0, chatGptConnected: null }));

let sequence = 0;
const resolvers = new Map<number, (outcome: DialogOutcome) => void>();

/** Abre un diálogo; resuelve al cerrarse con «done» (hecho) o «cancelled». */
export function openBillingDialog(dialog: BillingDialog): Promise<DialogOutcome> {
  const state = useBillingDialogs.getState();
  if (state.hosts === 0) return Promise.resolve('cancelled');
  if (state.current) settle(state.current.id, 'cancelled');
  const id = ++sequence;
  return new Promise(resolve => {
    resolvers.set(id, resolve);
    useBillingDialogs.setState({ current: { ...dialog, id } });
  });
}

function settle(id: number, outcome: DialogOutcome): void {
  const resolve = resolvers.get(id);
  resolvers.delete(id);
  resolve?.(outcome);
}

/** Cierra el diálogo `id` (si sigue siendo el abierto). */
export function closeBillingDialog(id: number, outcome: DialogOutcome = 'cancelled'): void {
  const { current } = useBillingDialogs.getState();
  settle(id, outcome);
  if (current?.id === id) useBillingDialogs.setState({ current: null });
}

export function registerBillingHost(): () => void {
  useBillingDialogs.setState(state => ({ hosts: state.hosts + 1 }));
  return () => {
    useBillingDialogs.setState(state => {
      const hosts = Math.max(0, state.hosts - 1);
      if (hosts === 0 && state.current) {
        settle(state.current.id, 'cancelled');
        return { hosts, current: null };
      }
      return { hosts };
    });
  };
}

/**
 * Lo que sabe el resto de la app sobre la conexión con ChatGPT (settings o
 * workspace lo indican). Con ChatGPT conectado, el aviso de tokens no ofrece
 * conectarlo otra vez.
 */
export function setChatGptConnected(connected: boolean | null): void {
  useBillingDialogs.setState({ chatGptConnected: connected });
}

/** Solo pruebas. */
export function resetBillingDialogs(): void {
  resolvers.forEach(resolve => resolve('cancelled'));
  resolvers.clear();
  useBillingDialogs.setState({ current: null, chatGptConnected: null });
}
