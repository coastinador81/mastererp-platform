import { dialog, toast, type DialogHandle } from '@/shared/ui';
import { currentAccountEmail } from '../state/session';
import { AccountDeletionConfirmation } from '../components/AccountDeletionConfirmation';

let opened: DialogHandle | null = null;

/** La cuenta y el chat comparten la misma confirmación; mostrarla nunca elimina. */
export function openAccountDeletion(account = currentAccountEmail()): void {
  if (!account || account !== currentAccountEmail()) { toast.error('Inicia sesión con la cuenta que quieres eliminar.'); return; }
  if (opened) return;
  opened = dialog.open({ title: 'Eliminar cuenta', size: 'md', className: 'account-deletion-dialog',
    body: controls => <AccountDeletionConfirmation account={account} controls={controls} />,
    onClose: () => { opened = null; },
  });
}

if (typeof window !== 'undefined') window.addEventListener('uonify:identity-changed', () => opened?.close());
