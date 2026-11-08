import { settingsPath } from '@/modules/settings';
import { toast } from '@/shared/ui';
import { queryClient } from '@/shared/api/queryClient';
import { logout } from '../api/authApi';
import { SIGNED_OUT } from '../model/session';
import { clearAuthStorage } from '../model/storage';
import { clearDeletedAccountStorage, notifyDeletedAccount, ACCOUNT_DELETED_KEY } from '../model/deletedAccountStorage';
import { currentAccountEmail, ensureSession, setSession } from '../state/session';
import { openSignInDialog } from './access';
import { captureFocus } from './focus';
import { HOME_PATH, navigation } from './navigation';
import { showProfile } from './profile';
import { recoverPendingAccountDeletion } from './pendingAccountDeletion';

/**
 * «Configuración» sustituye al diálogo «Mi cuenta». Se mantiene openAccount() por
 * compatibilidad: sin sesión abre el acceso; con el alta a medias, el alta; si
 * no, lleva a Configuración (el espacio ya enlaza settingsPath() directamente).
 */
export async function openAccount(): Promise<void> {
  captureFocus();
  const session = await ensureSession();
  if (recoverPendingAccountDeletion()) return;
  if (!session.authenticated) {
    openSignInDialog();
    return;
  }
  if (!session.profileReady) {
    showProfile();
    return;
  }
  navigation.go(settingsPath());
}

const SIGN_OUT_ERROR = 'No se pudo cerrar la sesión. Inténtalo de nuevo.';
let signingOut = false;

/** Salida local compartida; el borrado confirmado ya revocó la sesión en servidor. */
export async function completeSignOut(deletedAccount?: string, broadcast = true): Promise<void> {
  setSession(SIGNED_OUT);
  clearAuthStorage();
  window.dispatchEvent(new CustomEvent('uonify:identity-changed', { detail: { email: null } }));
  await queryClient.cancelQueries();
  queryClient.clear();
  if (deletedAccount) {
    clearDeletedAccountStorage(deletedAccount);
    if (broadcast) notifyDeletedAccount(deletedAccount);
  }
  setSession(SIGNED_OUT);
  navigation.hard(HOME_PATH);
}

if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== ACCOUNT_DELETED_KEY || !event.newValue) return;
  try {
    const value: unknown = JSON.parse(event.newValue);
    if (value && typeof value === 'object' && 'account' in value && typeof value.account === 'string'
      && value.account === currentAccountEmail()) void completeSignOut(value.account, false);
  } catch { /* Un aviso incompleto no cambia la sesión. */ }
});

/**
 * Cierra la sesión en el backend y vuelve al inicio con una carga completa, que
 * deja limpio el estado de todos los módulos (prototipo: signOut). No desconecta
 * el plan de ChatGPT: eso se hace en Configuración › Conexiones.
 */
export async function signOut(): Promise<void> {
  if (signingOut) return;
  signingOut = true;
  try {
    await logout();
    await completeSignOut();
  } catch {
    toast.error(SIGN_OUT_ERROR);
  } finally {
    signingOut = false;
  }
}
