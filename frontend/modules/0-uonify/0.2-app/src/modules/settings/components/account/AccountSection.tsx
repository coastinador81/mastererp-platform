import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Button, Field, Input, Select, toast } from '@/shared/ui';
import { settingsKeys } from '../../api/endpoints';
import { patchAccount } from '../../api/settingsApi';
import { useAccount } from '../../hooks/queries';
import {
  accountChanges,
  accountForm,
  deviceTimeZone,
  NAME_MAX,
  timeZoneOptions,
  validateName,
  type AccountForm,
} from '../../model/account';
import type { Account } from '../../model/types';
import { LoadError, Loading, SettingsCard } from '../common';
import { AvatarField } from './AvatarField';
import { EmailChangeDialog } from './EmailChangeDialog';
import { LanguageGlobe } from './LanguageGlobe';

/** Cuenta: foto, nombre, correo, idioma y zona horaria. */
export function AccountSection() {
  const query = useAccount();
  if (query.isPending) return <Loading />;
  if (query.isError) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  const account = query.data;
  // La clave reinicia el formulario cuando cambia lo guardado.
  return <AccountDetails key={`${account.name}|${account.language}|${account.timeZone}`} account={account} />;
}

function AccountDetails({ account }: { account: Account }) {
  const client = useQueryClient();
  const saved = accountForm(account);
  const [form, setForm] = useState<AccountForm>(saved);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const changes = accountChanges(saved, form);
  const dirty = Object.keys(changes).length > 0;
  const device = deviceTimeZone();

  const save = useMutation({
    mutationFn: patchAccount,
    onSuccess: next => {
      client.setQueryData<Account>(settingsKeys.account, next);
      toast.success('Cambios guardados');
    },
    onError: reason => toast.error('No se han podido guardar los cambios', { description: errorMessage(reason) }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = validateName(form.name);
    setNameError(problem);
    if (problem || !dirty) return;
    save.mutate(changes);
  };

  return (
    <div className="uset-stack">
      <SettingsCard title="Perfil" description="Así te ven las personas de tu equipo.">
        <form className="uset-form" onSubmit={submit} noValidate>
          <AvatarField account={account} />
          <Field label="Nombre" error={nameError ?? undefined} hint={`Hasta ${NAME_MAX} caracteres.`}>
            <Input
              value={form.name}
              autoComplete="name"
              maxLength={NAME_MAX + 20}
              onChange={event => { setForm({ ...form, name: event.target.value }); setNameError(null); }}
              invalid={Boolean(nameError)}
            />
          </Field>
          <div className="uset-email-row">
            <div>
              <p className="pim-label">Correo electrónico</p>
              <p className="uset-value">{account.email}</p>
              <p className="pim-hint">Es el correo con el que entras y al que llegan los avisos de tu cuenta.</p>
            </div>
            <Button size="sm" onClick={() => setEmailOpen(true)} aria-label="Cambiar el correo electrónico">Cambiar</Button>
          </div>
          <div className="uset-grid-2">
            <Field label="Idioma" hint="El inglés estará disponible al completar la traducción.">
              <LanguageGlobe value={form.language} onChange={language => setForm({ ...form, language })} />
            </Field>
            <Field
              label="Zona horaria"
              hint={form.timeZone !== device ? `La de este dispositivo es ${device.replace(/_/g, ' ')}.` : 'Coincide con la de este dispositivo.'}
            >
              <Select value={form.timeZone} onChange={event => setForm({ ...form, timeZone: event.target.value })} options={timeZoneOptions(form.timeZone)} />
            </Field>
          </div>
          <div className="uset-form-actions">
            {dirty ? <Button onClick={() => { setForm(saved); setNameError(null); }} disabled={save.isPending}>Descartar</Button> : null}
            <Button variant="primary" type="submit" loading={save.isPending} disabled={!dirty}>Guardar cambios</Button>
          </div>
        </form>
      </SettingsCard>
      <EmailChangeDialog open={emailOpen} currentEmail={account.email} onClose={() => setEmailOpen(false)} />
    </div>
  );
}
