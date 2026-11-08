import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Badge, Button, dialog, toast } from '@/shared/ui';
import { settingsKeys } from '../../api/endpoints';
import { disableSms, disableTotp, regenerateRecoveryCodes } from '../../api/settingsApi';
import { useMfa } from '../../hooks/queries';
import { formatDate } from '../../model/format';
import type { MfaStatus } from '../../model/types';
import { LoadError, Loading, SettingRow, SettingsCard } from '../common';
import { RecoveryCodesDialog } from './RecoveryCodesDialog';
import { SmsSetupDialog } from './SmsSetupDialog';
import { TotpSetupDialog } from './TotpSetupDialog';

type Open = 'totp' | 'sms' | null;

/** Verificación en dos pasos: app de autenticación (recomendada), SMS como segunda opción y códigos de recuperación. */
export function MfaCard({ email }: { email: string }) {
  const client = useQueryClient();
  const query = useMfa();
  const [open, setOpen] = useState<Open>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const setStatus = (status: MfaStatus) => {
    client.setQueryData<MfaStatus>(settingsKeys.mfa, status);
    void client.invalidateQueries({ queryKey: settingsKeys.connections });
  };

  const remove = useMutation({
    mutationFn: (method: 'totp' | 'sms') => (method === 'totp' ? disableTotp() : disableSms()),
    onSuccess: (status, method) => {
      setStatus(status);
      toast.success(method === 'totp' ? 'App de autenticación desactivada' : 'Móvil quitado');
    },
    onError: reason => toast.error('No se ha podido desactivar', { description: errorMessage(reason) }),
  });
  const regenerate = useMutation({
    mutationFn: regenerateRecoveryCodes,
    onSuccess: result => {
      setStatus(result.status);
      if (result.recoveryCodes) setCodes(result.recoveryCodes);
    },
    onError: reason => toast.error('No se han podido crear los códigos', { description: errorMessage(reason) }),
  });

  const confirmRemove = async (method: 'totp' | 'sms', status: MfaStatus) => {
    const last = method === 'totp' ? !status.sms.enabled : !status.totp.enabled;
    const ok = await dialog.confirm({
      title: method === 'totp' ? '¿Desactivar la app de autenticación?' : '¿Quitar tu móvil?',
      description: last
        ? 'Es tu único segundo paso: la verificación en dos pasos quedará desactivada y tus códigos de recuperación dejarán de valer.'
        : 'Seguirás entrando con el otro método que tienes activado.',
      confirmLabel: method === 'totp' ? 'Desactivar' : 'Quitar',
      destructive: true,
    });
    if (ok) remove.mutate(method);
  };

  const confirmRegenerate = async () => {
    const ok = await dialog.confirm({
      title: '¿Crear códigos nuevos?',
      description: 'Los códigos que tienes ahora dejarán de valer.',
      confirmLabel: 'Crear códigos nuevos',
    });
    if (ok) regenerate.mutate();
  };

  if (query.isPending) return <SettingsCard title="Verificación en dos pasos" icon="shield"><Loading /></SettingsCard>;
  if (query.isError) return <SettingsCard title="Verificación en dos pasos" icon="shield"><LoadError error={query.error} onRetry={() => void query.refetch()} /></SettingsCard>;
  const status = query.data;

  return (
    <SettingsCard
      title="Verificación en dos pasos"
      icon="shield"
      badge={status.enabled ? <Badge tone="green" icon="check">Activada</Badge> : <Badge tone="amber">Desactivada</Badge>}
      description="Al entrar, además de tu acceso, te pediremos un código. Amazon lo exige para conectar tu cuenta de vendedor."
    >
      <div className="uset-rows">
        <SettingRow
          icon="uset-key"
          title="App de autenticación"
          badge={<Badge tone="blue">Recomendada</Badge>}
          description={status.totp.enabled ? `Activada el ${formatDate(status.totp.addedAt)}.` : 'Google Authenticator, Microsoft Authenticator, 1Password u otra app que genere códigos.'}
          actions={status.totp.enabled
            ? <Button size="sm" variant="ghost" onClick={() => void confirmRemove('totp', status)} disabled={remove.isPending}>Desactivar</Button>
            : <Button size="sm" variant={status.enabled ? 'outline' : 'primary'} onClick={() => setOpen('totp')}>Configurar</Button>}
        />
        <SettingRow
          icon="uset-phone"
          title="Mensaje de texto (SMS)"
          
          description={status.sms.enabled ? `Código a ${status.sms.phoneMasked}.` : 'Un código de 6 cifras en tu móvil. Es menos seguro que la app: úsalo como segunda opción.'}
          actions={status.sms.enabled
            ? <Button size="sm" variant="ghost" onClick={() => void confirmRemove('sms', status)} disabled={remove.isPending}>Quitar</Button>
            : <Button size="sm" onClick={() => setOpen('sms')}>Añadir móvil</Button>}
        />
        <SettingRow
          icon="uset-lock"
          title="Códigos de recuperación"
          description={status.enabled
            ? `Te quedan ${status.recoveryCodes.remaining} de ${status.recoveryCodes.total}. Cada código sirve una vez si pierdes el móvil.`
            : 'Se crean al activar la verificación en dos pasos.'}
          actions={<Button size="sm" onClick={() => void confirmRegenerate()} disabled={!status.enabled || regenerate.isPending} loading={regenerate.isPending}>Crear nuevos</Button>}
        />
        <SettingRow
          icon="uset-mail"
          title="Correo de recuperación"
          description={<><span className="uset-strong">{status.recoveryEmail}</span>. Solo sirve para recuperar el acceso si pierdes tus métodos; nunca como segundo paso.</>}
        />
      </div>
      {open === 'totp' ? <TotpSetupDialog email={email} onClose={() => setOpen(null)} /> : null}
      {open === 'sms' ? <SmsSetupDialog email={email} onClose={() => setOpen(null)} /> : null}
      {codes ? <RecoveryCodesDialog codes={codes} email={email} onClose={() => setCodes(null)} /> : null}
    </SettingsCard>
  );
}
