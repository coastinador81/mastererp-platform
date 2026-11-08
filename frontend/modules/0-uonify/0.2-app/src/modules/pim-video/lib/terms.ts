import { currentAccountEmail } from '@/modules/auth';
import { TERMS_KEY, TERMS_VERSION } from '../model/constants';

/**
 * Aceptación de las condiciones de los modelos de IA (prototipo: pim/video.js).
 * Es de cada cuenta (como multiTenantStorage) y se envía al servidor con su fecha
 * (`terms_version`, `terms_accepted_at`). Solo guarda la versión y la fecha: nada secreto.
 */

export interface TermsRecord {
  version: string;
  acceptedAt: string;
}

/**
 * Cuenta con la sesión abierta: la del módulo auth y, si no hay, como el prototipo
 * (localStorage 'uonify-session': { user: { email | id } }).
 */
export function currentAccount(storage: Pick<Storage, 'getItem'> | null = safeLocalStorage()): string | null {
  const account = currentAccountEmail();
  if (account) return account;
  try {
    const session = JSON.parse(storage?.getItem('uonify-session') || 'null') as { user?: { email?: string; id?: string } } | null;
    return session?.user?.email || session?.user?.id || null;
  } catch {
    return null;
  }
}

export function termsKey(user: string | null = currentAccount()): string {
  return user ? `${user}:${TERMS_KEY}` : TERMS_KEY;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** La aceptación vigente (de esta versión del texto), o null. */
export function termsRecord(storage: Pick<Storage, 'getItem'> | null = safeLocalStorage(), user: string | null = currentAccount()): TermsRecord | null {
  try {
    const record = JSON.parse(storage?.getItem(termsKey(user)) || 'null') as TermsRecord | null;
    return record?.version === TERMS_VERSION ? record : null;
  } catch {
    return null;
  }
}

export function acceptTerms(storage: Pick<Storage, 'setItem'> | null = safeLocalStorage(), user: string | null = currentAccount(), now = new Date()): TermsRecord {
  const record: TermsRecord = { version: TERMS_VERSION, acceptedAt: now.toISOString() };
  try {
    storage?.setItem(termsKey(user), JSON.stringify(record));
  } catch {
    /* sin almacenamiento: se vuelve a pedir */
  }
  return record;
}
