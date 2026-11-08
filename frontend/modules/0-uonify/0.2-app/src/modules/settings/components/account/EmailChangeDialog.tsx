import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useInterval } from '@/shared/hooks';
import { Button, Dialog, Field, Input, LinkButton, toast } from '@/shared/ui';
import { settingsKeys } from '../../api/endpoints';
import { confirmEmailChange, startEmailChange } from '../../api/settingsApi';
import { isEmail } from '../../model/format';
import { isSixDigitCode } from '../../model/security';
import type { Account } from '../../model/types';
import { CodeField } from '../CodeField';

export interface EmailChangeDialogProps {
  open: boolean;
  currentEmail: string;
  onClose: () => void;
}

/** Cambiar el correo: se envía un código a la nueva dirección y, hasta confirmarlo, se sigue entrando con la actual. */
export function EmailChangeDialog({ open, currentEmail, onClose }: EmailChangeDialogProps) {
  if (!open) return null;
  return <EmailChangeFlow currentEmail={currentEmail} onClose={onClose} />;
}

function EmailChangeFlow({ currentEmail, onClose }: Omit<EmailChangeDialogProps, 'open'>) {
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  useInterval(() => setWait(seconds => Math.max(0, seconds - 1)), wait > 0 ? 1000 : null);

  const start = useMutation({
    mutationFn: startEmailChange,
    onSuccess: result => {
      setSentTo(result.sentTo);
      setWait(result.resendInSec);
      setError(null);
    },
    onError: reason => {
      const retry = reason instanceof ApiError ? Number((reason.data as { retryAfterSec?: unknown } | null)?.retryAfterSec) : NaN;
      if (Number.isFinite(retry)) setWait(retry);
      setError(errorMessage(reason, 'No se ha podido enviar el código.'));
    },
  });
  const confirm = useMutation({
    mutationFn: confirmEmailChange,
    onSuccess: account => {
      client.setQueryData<Account>(settingsKeys.account, account);
      void client.invalidateQueries({ queryKey: settingsKeys.mfa });
      void client.invalidateQueries({ queryKey: settingsKeys.signInMethods });
      toast.success('Correo actualizado', { description: `Ahora entras con ${account.email}.` });
      onClose();
    },
    onError: reason => setError(errorMessage(reason, 'No se ha podido confirmar el código.')),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!sentTo) {
      if (!isEmail(email)) return setError('Escribe un correo electrónico válido.');
      if (email.trim().toLowerCase() === currentEmail.toLowerCase()) return setError('Ese ya es el correo de tu cuenta.');
      start.mutate(email.trim());
      return;
    }
    if (!isSixDigitCode(code)) return setError('Escribe el código de 6 cifras que te hemos enviado.');
    confirm.mutate(code);
  };

  const busy = start.isPending || confirm.isPending;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Cambiar el correo"
      description={sentTo ? `Hemos enviado un código a ${sentTo}.` : 'Te enviaremos un código a la nueva dirección. Hasta que la confirmes, seguirás entrando con la actual.'}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="uset-email-form" loading={busy}>
            {sentTo ? 'Confirmar correo' : 'Enviar código'}
          </Button>
        </>
      }
    >
      <form id="uset-email-form" className="pim-stack" onSubmit={submit} noValidate>
        {sentTo ? (
          <>
            <CodeField value={code} onChange={value => { setCode(value); setError(null); }} error={error} autoFocus />
            <p className="pim-small pim-muted">
              {wait > 0 ? `Podrás pedir otro código en ${wait} s.` : (
                <LinkButton onClick={() => start.mutate(sentTo)} disabled={busy}>Enviar otro código</LinkButton>
              )}
            </p>
          </>
        ) : (
          <Field label="Nuevo correo" error={error ?? undefined}>
            <Input type="email" autoComplete="email" value={email} onChange={event => { setEmail(event.target.value); setError(null); }} data-autofocus="" invalid={Boolean(error)} />
          </Field>
        )}
      </form>
    </Dialog>
  );
}
