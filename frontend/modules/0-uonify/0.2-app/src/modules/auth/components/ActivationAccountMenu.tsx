import { AccountMenu } from '@/modules/workspace';
import { openAccount } from '../flows/account';
import { currentSession } from '../state/session';
import { requestFocus } from '../state/authUi';

/** El mismo menú de cuenta; el acceso a Configuración conserva las guardas del alta. */
export function ActivationAccountMenu() {
  return <AccountMenu onOpenSettings={() => {
    // El alta ya es la configuración pendiente. Reabrirla perdería borradores
    // locales que todavía no corresponde enviar al servidor.
    const session = currentSession();
    if (session.authenticated && !session.profileReady) { requestFocus('#account-button'); return; }
    void openAccount();
  }} />;
}
