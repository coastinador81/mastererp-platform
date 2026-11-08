import { useEffect, useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useInterval } from '@/shared/hooks';
import { Alert, Button, Dialog, Field, Input, LinkButton, Select, toast } from '@/shared/ui';
import { settingsKeys } from '../../api/endpoints';
import { startSms, verifySms } from '../../api/settingsApi';
import { COUNTRY_PREFIXES, isSixDigitCode, retryText, toE164 } from '../../model/security';
import type { MfaStatus, SmsSetup } from '../../model/types';
import { CodeField } from '../CodeField';
import { RecoveryCodesDialog } from './RecoveryCodesDialog';

export interface SmsSetupDialogProps {
  email: string;
  onClose: () => void;
}

const retryAfter = (reason: unknown): number => {
  const value = reason instanceof ApiError ? Number((reason.data as { retryAfterSec?: unknown } | null)?.retryAfterSec) : NaN;
  return Number.isFinite(value) ? value : 0;
};

/**
 * Añadir el móvil (SMS) como segunda opción. Cada SMS cuesta dinero, así que el
 * backend limita los envíos (1 por minuto, 5 por hora y 10 al día) y aquí se
 * enseña cuánto falta para poder pedir otro.
 */
export function SmsSetupDialog({ email, onClose }: SmsSetupDialogProps) {
  const client = useQueryClient();
  const codeId = useId();
  const [prefix, setPrefix] = useState(COUNTRY_PREFIXES[0].prefix);
  const [number, setNumber] = useState('');
  const [sent, setSent] = useState<SmsSetup | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [codes, setCodes] = useState<string[] | null>(null);
  useInterval(() => setWait(seconds => Math.max(0, seconds - 1)), wait > 0 ? 1000 : null);

  const send = useMutation({
    mutationFn: startSms,
    onSuccess: result => {
      setSent(result);
      setWait(result.resendInSec);
      setError(null);
    },
    onError: reason => {
      setWait(retryAfter(reason));
      setError(errorMessage(reason, 'No se ha podido enviar el SMS.'));
    },
  });
  const verify = useMutation({
    mutationFn: (value: string) => verifySms(sent?.setupId ?? '', value),
    onSuccess: result => {
      client.setQueryData<MfaStatus>(settingsKeys.mfa, result.status);
      if (result.recoveryCodes?.length) setCodes(result.recoveryCodes);
      else {
        toast.success('Móvil añadido como segunda opción');
        onClose();
      }
    },
    onError: reason => setError(errorMessage(reason, 'No se ha podido comprobar el código.')),
  });

  useEffect(() => {
    if (sent) document.getElementById(codeId)?.focus();
  }, [sent, codeId]);

  const phone = toE164(prefix, number);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!sent) {
      if (!phone) return setError('Escribe un número de móvil válido.');
      send.mutate(phone);
      return;
    }
    if (!isSixDigitCode(code)) return setError('Escribe el código de 6 cifras del SMS.');
    verify.mutate(code);
  };

  const finish = () => {
    toast.success('Verificación en dos pasos activada');
    onClose();
  };

  if (codes) {
    return <RecoveryCodesDialog codes={codes} email={email} onClose={finish} title="Tus códigos de recuperación" description="Te permiten entrar si pierdes el móvil." />;
  }

  const busy = send.isPending || verify.isPending;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Añadir tu móvil"
      description={sent ? `Hemos enviado un código a ${sent.phoneMasked}.` : 'Te enviaremos un código de 6 cifras por SMS cada vez que lo necesites.'}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" form="uset-sms-form" loading={busy} disabled={!sent && wait > 0}>
            {sent ? 'Activar' : 'Enviar código'}
          </Button>
        </>
      }
    >
      <form id="uset-sms-form" className="pim-stack" onSubmit={submit} noValidate>
        {sent ? (
          <>
            <CodeField value={code} onChange={value => { setCode(value); setError(null); }} error={error} inputId={codeId} />
            <p className="pim-small pim-muted" aria-live="polite">
              {wait > 0 ? `Podrás pedir otro código en ${retryText(wait)}.` : (
                <LinkButton onClick={() => phone && send.mutate(phone)} disabled={busy}>Enviar otro SMS</LinkButton>
              )}
            </p>
          </>
        ) : (
          <>
            <Alert tone="amber" role="note">
              El SMS es menos seguro que una app de autenticación (por ejemplo, ante un duplicado de la tarjeta SIM). Úsalo como segunda opción.
            </Alert>
            <div className="uset-phone">
              <Field label="Prefijo">
                <Select value={prefix} onChange={event => setPrefix(event.target.value)} options={COUNTRY_PREFIXES.map(item => ({ value: item.prefix, label: item.label }))} />
              </Field>
              <Field label="Número de móvil" error={error ?? undefined}>
                <Input type="tel" inputMode="tel" autoComplete="tel-national" value={number} onChange={event => { setNumber(event.target.value); setError(null); }} data-autofocus="" invalid={Boolean(error)} />
              </Field>
            </div>
            {wait > 0 ? <p className="pim-small pim-muted" aria-live="polite">Podrás pedir otro código en {retryText(wait)}.</p> : null}
            
          </>
        )}
      </form>
    </Dialog>
  );
}
