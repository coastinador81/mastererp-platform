import { useId } from 'react';
import { download } from '@/shared/lib';
import { Alert, Button, Checkbox, toast } from '@/shared/ui';
import { recoveryCodesFile } from '../../model/security';

export interface RecoveryCodesProps {
  codes: readonly string[];
  email: string;
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
}

/** Los 10 códigos de recuperación, para copiarlos o descargarlos. Solo se enseñan una vez. */
export function RecoveryCodes({ codes, email, saved, onSavedChange }: RecoveryCodesProps) {
  const listId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Códigos copiados');
    } catch {
      toast.error('No se han podido copiar', { description: 'Descárgalos o apúntalos a mano.' });
    }
  };

  const save = () => {
    const url = URL.createObjectURL(new Blob([recoveryCodesFile(codes, email)], { type: 'text/plain;charset=utf-8' }));
    download(url, 'uonify-codigos-de-recuperacion.txt');
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="pim-stack">
      <Alert tone="amber" role="note" title="Guárdalos ahora">
        Si pierdes el móvil, cada código te deja entrar una vez. No volveremos a enseñártelos.
      </Alert>
      <ol className="uset-codes" id={listId} aria-label="Códigos de recuperación">
        {codes.map(code => <li key={code} className="pim-mono">{code}</li>)}
      </ol>
      <div className="pim-row uset-wrap">
        <Button size="sm" icon="copy" onClick={() => void copy()} aria-controls={listId}>Copiar</Button>
        <Button size="sm" icon="download" onClick={save}>Descargar</Button>
      </div>
      <Checkbox checked={saved} onCheckedChange={onSavedChange} label="He guardado mis códigos en un lugar seguro." />
    </div>
  );
}
