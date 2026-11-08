import { useAuthUi } from '../state/authUi';

/** Permite a facturación esperar al fundido antes de abrir su propio diálogo modal. */
export function useAccessTransition(): boolean {
  return useAuthUi(state => state.transition.open);
}
