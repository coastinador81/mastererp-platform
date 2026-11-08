interface Entry { account: string; consumer: string | null }
let entry: Entry | null = null;
const listeners = new Set<() => void>();
function update(value: Entry | null) { entry = value; listeners.forEach(listener => listener()); }

export const onboardingEntrySnapshot = () => entry;
export function subscribeOnboardingEntry(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Solo vive hasta la siguiente entrada: recargar nunca repite la bienvenida. */
export function prepareOnboardingEntry(account: string): void {
  update(account.trim() ? { account: account.trim(), consumer: null } : null);
}

export function takeOnboardingEntry(account: string, consumer?: string): boolean {
  const matches = entry?.account === account && entry.consumer === null;
  update(matches && consumer ? { account, consumer } : null);
  return matches;
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => { update(null); });
