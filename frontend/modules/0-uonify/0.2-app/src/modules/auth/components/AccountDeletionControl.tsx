import { Button } from '@/shared/ui';
import { openAccountDeletion } from '../flows/accountDeletion';
import '../styles/account-deletion.css';

interface Props { account: string; presentation?: 'account' | 'conversation' }

export function AccountDeletionControl({ account, presentation = 'account' }: Props) {
  return <section className={`account-deletion-control is-${presentation}`} aria-label="Eliminar cuenta de Uonify">
    <div><h3>Eliminar cuenta</h3><p>Elimina definitivamente tu cuenta y el trabajo guardado en Uonify. Podrás revisar lo que se borrará antes de confirmar.</p></div>
    <Button className="account-deletion-open" onClick={() => openAccountDeletion(account)}>Eliminar cuenta</Button>
  </section>;
}
