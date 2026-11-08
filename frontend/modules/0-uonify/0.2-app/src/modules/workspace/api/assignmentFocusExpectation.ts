import { currentAccountEmail } from '@/modules/auth';

export interface ExpectedAssignmentFocus {
  account: string;
  threadId: string;
  assignmentId: string;
  version: number;
}

const prefix = 'uonify:expected-assignment-focus:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyFor = (account: string, threadId: string) => prefix + JSON.stringify([account, threadId]);

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; }
  catch { return null; }
}

export function expectedAssignmentFocus(account: string, threadId: string):
  { kind: 'none' } | { kind: 'ready'; value: ExpectedAssignmentFocus } | { kind: 'unavailable' } {
  const store = storage();
  if (!store || currentAccountEmail() !== account) return { kind: 'unavailable' };
  try {
    const raw = store.getItem(keyFor(account, threadId));
    if (raw === null) return { kind: 'none' };
    if (raw.length > 1000) return { kind: 'unavailable' };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { kind: 'unavailable' };
    const row = value as Partial<ExpectedAssignmentFocus>;
    if (row.account !== account || row.threadId !== threadId || typeof row.assignmentId !== 'string'
      || !uuid.test(row.assignmentId) || !Number.isSafeInteger(row.version) || row.version! < 1)
      return { kind: 'unavailable' };
    return { kind: 'ready', value: row as ExpectedAssignmentFocus };
  } catch { return { kind: 'unavailable' }; }
}

/** Persiste antes de cerrar la tarjeta: el próximo mensaje debe llevar este CAS. */
export function rememberExpectedAssignmentFocus(account: string, threadId: string,
  assignmentId: string, version: number): boolean {
  const store = storage();
  if (!store || currentAccountEmail() !== account || !uuid.test(assignmentId)
    || !Number.isSafeInteger(version) || version < 1) return false;
  try {
    store.setItem(keyFor(account, threadId), JSON.stringify({ account, threadId, assignmentId, version }));
    const confirmed = expectedAssignmentFocus(account, threadId);
    return confirmed.kind === 'ready' && confirmed.value.assignmentId === assignmentId && confirmed.value.version === version;
  } catch { return false; }
}

export function clearExpectedAssignmentFocus(account: string, threadId: string): void {
  try { storage()?.removeItem(keyFor(account, threadId)); } catch { /* El borrado del hilo sigue siendo efectivo en servidor. */ }
}

function clearTabExpectations(): void {
  const store = storage();
  if (!store) return;
  try {
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index));
    keys.forEach(key => { if (key?.startsWith(prefix)) store.removeItem(key); });
  } catch { /* La nueva identidad nunca lee la expectativa de la anterior. */ }
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', clearTabExpectations);
