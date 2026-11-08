import { currentAccountEmail } from '@/modules/auth';
import { api } from '@/shared/api/client';

export interface AssignmentFocusIntent {
  account: string;
  threadId: string;
  assignmentId: string;
  expectedVersion: number;
  requestId: string;
}

const prefix = 'uonify:assignment-focus:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const keyFor = (account: string, threadId: string) => prefix + JSON.stringify([account, threadId]);

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; }
  catch { return null; }
}

function valid(value: unknown, account: string, threadId: string): value is AssignmentFocusIntent {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AssignmentFocusIntent>;
  return row.account === account && row.threadId === threadId
    && typeof row.assignmentId === 'string' && uuid.test(row.assignmentId)
    && typeof row.requestId === 'string' && uuid.test(row.requestId)
    && Number.isSafeInteger(row.expectedVersion) && row.expectedVersion! >= 0;
}

export function readAssignmentFocusIntent(account: string, threadId: string): AssignmentFocusIntent | null {
  const store = storage();
  if (!store || currentAccountEmail() !== account) return null;
  try {
    const raw = store.getItem(keyFor(account, threadId));
    if (!raw || raw.length > 1000) return null;
    const value: unknown = JSON.parse(raw);
    return valid(value, account, threadId) ? value : null;
  } catch { return null; }
}

export function assignmentFocusStorageState(account: string, threadId: string): 'absent' | 'valid' | 'invalid' | 'unavailable' {
  const store = storage();
  if (!store || currentAccountEmail() !== account) return 'unavailable';
  try {
    const raw = store.getItem(keyFor(account, threadId));
    if (raw === null) return 'absent';
    return readAssignmentFocusIntent(account, threadId) ? 'valid' : 'invalid';
  } catch { return 'unavailable'; }
}

/** Tras un GET fresco, solo retira una entrada ilegible; nunca elimina un UUID válido de otra pestaña. */
export function clearInvalidAssignmentFocusIntent(account: string, threadId: string): boolean {
  const store = storage();
  if (!store || currentAccountEmail() !== account) return false;
  try {
    const raw = store.getItem(keyFor(account, threadId));
    if (raw === null || assignmentFocusStorageState(account, threadId) !== 'invalid'
      || store.getItem(keyFor(account, threadId)) !== raw) return false;
    store.removeItem(keyFor(account, threadId));
    return assignmentFocusStorageState(account, threadId) === 'absent';
  } catch { return false; }
}

/** Una escritura incierta bloquea otro UUID hasta reintentar o conciliar el anterior. */
export function prepareAssignmentFocusIntent(account: string, threadId: string,
  assignmentId: string, expectedVersion: number): AssignmentFocusIntent | null {
  const store = storage();
  if (!store || currentAccountEmail() !== account || !uuid.test(assignmentId)
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return null;
  const key = keyFor(account, threadId);
  try {
    const raw = store.getItem(key);
    if (raw !== null) {
      const saved = readAssignmentFocusIntent(account, threadId);
      return saved && saved.assignmentId === assignmentId && saved.expectedVersion === expectedVersion ? saved : null;
    }
    const intent = { account, threadId, assignmentId, expectedVersion, requestId: crypto.randomUUID() };
    store.setItem(key, JSON.stringify(intent));
    const saved = readAssignmentFocusIntent(account, threadId);
    return saved?.requestId === intent.requestId ? saved : null;
  } catch { return null; }
}

export function clearAssignmentFocusIntent(intent: AssignmentFocusIntent): void {
  const store = storage();
  if (!store) return;
  try {
    const saved = readAssignmentFocusIntent(intent.account, intent.threadId);
    if (saved?.requestId === intent.requestId) store.removeItem(keyFor(intent.account, intent.threadId));
  } catch { /* Una limpieza fallida conserva el UUID: no se inicia otra selección a ciegas. */ }
}

export async function submitAssignmentFocus(intent: AssignmentFocusIntent, signal?: AbortSignal):
  Promise<{ currentId: string | null; version: number; appliedId: string | null }> {
  const result = await api.put<{ focus?: { version?: number; current?: { id?: string } | null };
    replayed?: boolean; outcome?: { assignmentId?: string } }>(
    `/uony/threads/${encodeURIComponent(intent.threadId)}/assignment-focus`,
    { requestId: intent.requestId, assignmentId: intent.assignmentId, expectedVersion: intent.expectedVersion }, { signal });
  const focus = result?.focus;
  if (!focus || !Number.isSafeInteger(focus.version) || focus.version! < 0
    || (focus.current !== null && typeof focus.current?.id !== 'string')
    || (result.outcome && typeof result.outcome.assignmentId !== 'string')
    || (result.replayed === true && !result.outcome)) {
    throw new Error('No hemos podido confirmar qué encargo quedó seleccionado.');
  }
  return { currentId: focus.current?.id ?? null, version: focus.version!,
    appliedId: result.outcome?.assignmentId ?? (focus.current?.id ?? null) };
}
