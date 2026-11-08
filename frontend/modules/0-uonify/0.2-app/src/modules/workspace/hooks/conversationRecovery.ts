import { create } from 'zustand';
import type { ConnectionAction } from '../model/connectionActions';

export interface Recovery {
  account: string;
  threadId: string | null;
  message: string;
  actions: ConnectionAction[];
}

/** Recuperación en la tarjeta conversacional existente, sin crear otro modal. */
export const useConversationRecovery = create<{ recovery: Recovery | null }>(() => ({ recovery: null }));

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => {
  useConversationRecovery.setState({ recovery: null });
});
