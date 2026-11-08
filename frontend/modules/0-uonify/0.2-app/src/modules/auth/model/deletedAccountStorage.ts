const TAB_KEYS = new Set(['uonify-pim-v1', 'uonify-product-guides-v1', 'uonify-catalog-channels-v1',
  'uonify-home-workspace-v1', 'uonify.amazon.intent', 'uonify-composer-preferences',
  'uonify-composer-dismissed-suggestions', 'uonify-preferences']);
export const ACCOUNT_DELETED_KEY = 'uonify-account-deleted';
const ACCOUNT_INTENT_PREFIXES = [
  'uonify:product-proposal-decision:v1:', 'uonify:return-retry:', 'uonify:assignment-focus:',
  'uonify:expected-assignment-focus:',
];

function accountIntentBelongsTo(key: string, account: string): boolean {
  const prefix = ACCOUNT_INTENT_PREFIXES.find((candidate) => key.startsWith(candidate));
  if (!prefix) return false;
  try {
    const scope: unknown = JSON.parse(key.slice(prefix.length));
    return Array.isArray(scope) && scope[0] === account
      && scope.length === (prefix === 'uonify:assignment-focus:'
        || prefix === 'uonify:expected-assignment-focus:' ? 2 : 3);
  } catch { return false; }
}

/** Retira los datos privados de esta pestaña y los prefijos de la cuenta, conservando otras cuentas. */
export function clearDeletedAccountStorage(account: string): void {
  for (const kind of ['sessionStorage', 'localStorage'] as const) {
    try {
      const storage = window[kind];
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) {
        if (key && (key.startsWith(`${account}:`) || key.startsWith(`u_${account}::`)
          || key === `uonify-voice-intro-dismissed:${account}`
          || accountIntentBelongsTo(key, account)
          || key === 'uonify-session' && legacyAccount(storage.getItem(key)) === account
          || kind === 'sessionStorage' && TAB_KEYS.has(key))) storage.removeItem(key);
      }
    } catch { /* El cierre de sesión y la recarga siguen disponibles con almacenamiento bloqueado. */ }
  }
}

function legacyAccount(raw: string | null): string | null {
  try { return (JSON.parse(raw || 'null') as { user?: { email?: string } } | null)?.user?.email ?? null; }
  catch { return null; }
}

export function notifyDeletedAccount(account: string): void {
  try {
    localStorage.setItem(ACCOUNT_DELETED_KEY, JSON.stringify({ account, at: Date.now(), id: crypto.randomUUID() }));
    localStorage.removeItem(ACCOUNT_DELETED_KEY);
  }
  catch { /* Las demás pestañas volverán a comprobar su sesión al recibir el foco. */ }
}
