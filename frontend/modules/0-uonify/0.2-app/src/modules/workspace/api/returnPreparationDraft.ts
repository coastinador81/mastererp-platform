/** Copia temporal de una edición del chat. sessionStorage sobrevive recarga, no cierre de pestaña. */
export interface ReturnPreparationDraftScope {
  account: string;
  threadId: string;
  sku: string;
  revision: number;
  sectionId: string;
}

interface SavedDraft { scope: ReturnPreparationDraftScope; answers: Record<string, string> }
const prefix = 'uonify:return-preparation-draft:';
const maxLength = 16_000;
const keyFor = (scope: ReturnPreparationDraftScope) => prefix + JSON.stringify([
  scope.account, scope.threadId, scope.sku, scope.revision, scope.sectionId,
]);

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; }
  catch { return null; }
}

function parsed(raw: string | null): SavedDraft | null {
  if (!raw || raw.length > maxLength) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedDraft>;
    const scope = value.scope;
    const answers = value.answers;
    if (!scope || typeof scope.account !== 'string' || typeof scope.threadId !== 'string'
      || typeof scope.sku !== 'string' || !Number.isSafeInteger(scope.revision)
      || typeof scope.sectionId !== 'string' || !answers || typeof answers !== 'object'
      || Array.isArray(answers) || Object.keys(answers).length > 30
      || !Object.entries(answers).every(([field, text]) => field.length <= 100
        && typeof text === 'string' && text.length <= 3000)) return null;
    return { scope: scope as ReturnPreparationDraftScope, answers: answers as Record<string, string> };
  } catch { return null; }
}

export function readReturnPreparationDraft(scope: ReturnPreparationDraftScope): Record<string, string> | null {
  try {
    const saved = parsed(storage()?.getItem(keyFor(scope)) ?? null);
    return saved && keyFor(saved.scope) === keyFor(scope) ? { ...saved.answers } : null;
  } catch { return null; }
}

/** Mantiene una copia visible/copiable aunque otra pestaña avance la revisión. */
export function visibleReturnPreparationDrafts(account: string, threadId: string, sku: string): SavedDraft[] {
  const store = storage();
  if (!store) return [];
  const result: SavedDraft[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key?.startsWith(prefix)) continue;
      const saved = parsed(store.getItem(key));
      if (saved && keyFor(saved.scope) === key && saved.scope.account === account
        && saved.scope.threadId === threadId && saved.scope.sku === sku) result.push(saved);
    }
  } catch { return result; }
  return result;
}

/** Si no cabe, devuelve false para avisar; nunca expulsa otro texto sin guardar. */
export function rememberReturnPreparationDraft(scope: ReturnPreparationDraftScope,
  answers: Record<string, string>): boolean {
  const store = storage();
  if (!store) return false;
  const key = keyFor(scope);
  const raw = JSON.stringify({ scope, answers });
  if (raw.length > maxLength || !parsed(raw)) return false;
  try {
    const previous = store.getItem(key);
    if (previous && !parsed(previous)) return false;
    store.setItem(key, raw);
    return !!readReturnPreparationDraft(scope);
  } catch { return false; }
}

export function clearReturnPreparationDraft(scope: ReturnPreparationDraftScope): void {
  try { storage()?.removeItem(keyFor(scope)); } catch { /* No alteramos otra cuenta ni revisión. */ }
}

export function clearAllReturnPreparationDrafts(): void {
  const store = storage();
  if (!store) return;
  try {
    for (let index = store.length - 1; index >= 0; index -= 1) {
      const key = store.key(index);
      if (key?.startsWith(prefix)) store.removeItem(key);
    }
  } catch { /* Los accesos siguen acotados por cuenta, hilo y SKU. */ }
}
