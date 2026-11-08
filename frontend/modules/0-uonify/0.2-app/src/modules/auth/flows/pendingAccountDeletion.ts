import { settingsPath } from '@/modules/settings';
import { patchUi } from '../state/authUi';
import { currentSession } from '../state/session';
import { openAccountDeletion } from './accountDeletion';
import { navigation } from './navigation';
import { hideWorkspaceTransition } from './transition';

/** Una eliminación pendiente se recupera antes del alta o de cualquier pago. */
export function recoverPendingAccountDeletion(): boolean {
  const session = currentSession();
  if (!session.authenticated || !session.accountDeletionPending) return false;
  hideWorkspaceTransition();
  patchUi({ dialog: null, surface: { active: false, leaving: false } });
  const path = settingsPath();
  if (navigation.pathname() !== path && !navigation.navigating()) navigation.go(path, { replace: true });
  openAccountDeletion(session.email);
  return true;
}
