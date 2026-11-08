import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Alert, Button, Dialog, IconButton, toast } from '@/shared/ui';
import { settingsKeys } from '../../api/endpoints';
import { startTotp, verifyTotp } from '../../api/settingsApi';
import { groupSecret, isSixDigitCode } from '../../model/security';
import type { MfaStatus } from '../../model/types';
import { CodeField } from '../CodeField';
import { Loading } from '../common';
import { RecoveryCodesDialog } from './RecoveryCodesDialog';

export interface TotpSetupDialogProps {
  email: string;
  onClose: () => void;
}

/** Activar la app de autenticación: QR (o clave), código de 6 cifras y, si es el primer método, los 10 códigos de recuperación. */
export function TotpSetupDialog({ email, onClose }: TotpSetupDialogProps) {
  const client = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  const codeId = useId();
  const setup = useMutation({ mutationFn: startTotp });
  const { mutate: begin } = setup;
  useEffect(() => { begin(); }, [begin]);
  // El QR llega después de abrir el diálogo: entonces el foco pasa al campo del código.
  useEffect(() => {
    if (setup.data) document.getElementById(codeId)?.focus();
  }, [setup.data, codeId]);

  const verify = useMutation({
    mutationFn: (value: string) => verifyTotp(setup.data?.setupId ?? '', value),
    onSuccess: result => {
      client.setQueryData<MfaStatus>(settingsKeys.mfa, result.status);
      if (result.recoveryCodes?.length) setCodes(result.recoveryCodes);
      else {
        toast.success('App de autenticación activada');
        onClose();
      }
    },
    onError: reason => setError(errorMessage(reason, 'No se ha podido comprobar el código.')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isSixDigitCode(code)) return setError('Escribe el código de 6 cifras que muestra la app.');
    verify.mutate(code);
  };

  const finish = () => {
    toast.success('Verificación en dos pasos activada');
    onClose();
  };

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      toast.success('Clave copiada');
    } catch {
      toast.error('No se ha podido copiar la clave');
    }
  };

  if (codes) {
    return <RecoveryCodesDialog codes={codes} email={email} onClose={finish} title="Tus códigos de recuperación" description="Te permiten entrar si pierdes el móvil." />;
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Configurar la app de autenticación"
      description="Escanea el código con Google Authenticator, Microsoft Authenticator, 1Password u otra app que genere códigos."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="uset-totp-form" loading={verify.isPending} disabled={!setup.data}>Activar</Button>
        </>
      }
    >
      {setup.isPending ? <Loading label="Preparando el código QR…" /> : null}
      {setup.isError ? (
        <Alert tone="red" role="alert" title="No se ha podido preparar el código">
          {errorMessage(setup.error)} <Button size="sm" onClick={() => begin()}>Reintentar</Button>
        </Alert>
      ) : null}
      {setup.data ? (
        <form id="uset-totp-form" className="pim-stack" onSubmit={submit} noValidate>
          <div className="uset-qr">
            <img src={setup.data.qrDataUrl} alt="Código QR para añadir Uonify a tu app de autenticación" width={168} height={168} />
            
          </div>
          <div>
            <p className="pim-label">¿No puedes escanearlo? Escribe esta clave en la app:</p>
            <div className="uset-secret">
              <code className="pim-mono">{groupSecret(setup.data.secret)}</code>
              <IconButton icon="copy" size="sm" label="Copiar la clave" onClick={() => void copySecret(setup.data?.secret ?? '')} />
            </div>
          </div>
          <CodeField value={code} onChange={value => { setCode(value); setError(null); }} error={error} hint="El código cambia cada 30 segundos." inputId={codeId} />
        </form>
      ) : null}
    </Dialog>
  );
}
