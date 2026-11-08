import { create } from 'zustand';
import type { Guide } from './model';
const KEY = 'uonify-product-guides-v1';
function restore(): Record<string, Guide> {
  try {
    const data = JSON.parse(sessionStorage.getItem(KEY) || '{}') as Record<string, Guide>;
    return Object.fromEntries(Object.entries(data).filter(([, guide]) => guide?.threadId && guide.step).map(([id, guide]) => [id, {
      ...guide, busy: false, paused: guide.step === 'preparing' || guide.step === 'publishing' || guide.paused,
      step: guide.step === 'publishing' ? 'ready' : guide.step,
    }]));
  } catch { return {}; }
}
export const useGuideStore = create<{ guides: Record<string, Guide> }>(() => ({ guides: restore() }));
export const guideOf = (id: string) => useGuideStore.getState().guides[id];
export function patchGuide(id: string, patch: Partial<Guide>): void {
  useGuideStore.setState(state => ({ guides: { ...state.guides, [id]: { ...state.guides[id], ...patch } } }));
}
export function newGuide(id: string): Guide {
  const guide: Guide = { threadId: id, step: 'amazon', folder: '', progress: 0, paused: false, busy: false, error: '' };
  patchGuide(id, guide);
  return guide;
}
useGuideStore.subscribe(state => {
  try { sessionStorage.setItem(KEY, JSON.stringify(state.guides)); } catch { /* La sesión puede seguir en memoria. */ }
});
export let guideEpoch = 0;
export function resetGuides(): void {
  guideEpoch += 1;
  useGuideStore.setState({ guides: {} });
}
if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', resetGuides);
