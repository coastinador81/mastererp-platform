import { create } from 'zustand';
import { currentAccountEmail } from './session';

export const useActivationRequest = create<{ account: string | null }>(() => ({ account: null }));
export function openConversationActivation() {
  useActivationRequest.setState({ account: currentAccountEmail() });
}
export function closeConversationActivation() { useActivationRequest.setState({ account: null }); }
if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', closeConversationActivation);
