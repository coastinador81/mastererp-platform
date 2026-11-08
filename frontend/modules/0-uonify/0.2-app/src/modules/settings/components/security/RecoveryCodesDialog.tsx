import { useState } from 'react';
import { Button, Dialog } from '@/shared/ui';
import { RecoveryCodes } from './RecoveryCodes';

export interface RecoveryCodesDialogProps {
  codes: string[];
  email: string;
  onClose: () => void;
  title?: string;
  description?: string;
}

/** Códigos de recuperación recién creados: al activar el primer método o al crear otros nuevos. */
export function RecoveryCodesDialog({ codes, email, onClose, title = 'Tus códigos de recuperación nuevos', description = 'Los anteriores ya no valen.' }: RecoveryCodesDialogProps) {
  const [saved, setSaved] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={<Button variant="primary" onClick={onClose} disabled={!saved}>Terminar</Button>}
    >
      <RecoveryCodes codes={codes} email={email} saved={saved} onSavedChange={setSaved} />
    </Dialog>
  );
}
