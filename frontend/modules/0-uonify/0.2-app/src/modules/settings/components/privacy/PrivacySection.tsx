import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Dialog, Field, Input, toast } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import { requestExport, downloadExport, saveCookies, scheduleDeletion, cancelDeletion } from '../../api/settingsApi';
import { settingsKeys } from '../../api/endpoints';
import { usePrivacy } from '../../hooks/queries';
import { DELETION_CONSEQUENCES, deletionConfirmed, exportFileName, latestExport } from '../../model/privacy';
import { Loading, LoadError, SettingsCard } from '../common';

export function PrivacySection() {
  const query = usePrivacy();
  const client = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const action = useMutation({ mutationFn: (run: () => Promise<unknown>) => run(), onSuccess: () => { void client.invalidateQueries({ queryKey: settingsKeys.privacy }); }, onError: e => toast.error(errorMessage(e)) });
  if (query.isPending) return <Loading />;
  if (!query.data) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  const latest = latestExport(data.exports);
  const download = async () => {
    if (!latest) return;
    const blob = await downloadExport(latest.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = exportFileName(); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="pim-stack">
    <SettingsCard title="Descargar mis datos" description="Recibe una copia de la información de tu cuenta.">
      <Button variant="primary" disabled={action.isPending || latest?.status === 'preparing'} onClick={() => action.mutate(latest?.status === 'ready' ? download : requestExport)}>
        {latest?.status === 'ready' ? 'Descargar copia' : latest?.status === 'preparing' ? 'Preparando copia…' : 'Solicitar copia'}
      </Button>
    </SettingsCard>
    <SettingsCard title="Preferencias de cookies" description="Las cookies necesarias permiten que la aplicación funcione.">
      {(['analytics', 'marketing'] as const).map(key => <Checkbox key={key} label={key === 'analytics' ? 'Analítica' : 'Marketing'} checked={data.cookies[key]} disabled={action.isPending}
        onChange={e => action.mutate(() => saveCookies({ analytics: data.cookies.analytics, marketing: data.cookies.marketing, [key]: e.target.checked }))} />)}
    </SettingsCard>
    <SettingsCard title="Documentos aceptados">{data.documents.map(doc => <p key={doc.id}><a href={doc.href}>{doc.title}</a> · Versión {doc.version}</p>)}</SettingsCard>
    <SettingsCard title="Eliminar cuenta" tone="danger" description="Puedes cancelar la eliminación durante 30 días.">
      {data.deletion.status === 'scheduled' ? <><p>Eliminación prevista: {new Date(data.deletion.scheduledFor!).toLocaleDateString('es-ES')}.</p><Button disabled={action.isPending} onClick={() => action.mutate(cancelDeletion)}>Cancelar eliminación</Button></> : <Button onClick={() => { setConfirm(''); setDeleting(true); }}>Eliminar mi cuenta</Button>}
    </SettingsCard>
    {deleting ? <Dialog open title="Eliminar mi cuenta" onClose={() => setDeleting(false)} footer={<><Button onClick={() => setDeleting(false)}>Volver</Button><Button disabled={!deletionConfirmed(confirm)} loading={action.isPending} onClick={() => action.mutate(() => scheduleDeletion(confirm), { onSuccess: () => setDeleting(false) })}>Confirmar eliminación</Button></>}>
      <ul>{DELETION_CONSEQUENCES.map(text => <li key={text}>{text}</li>)}</ul><Field label="Escribe ELIMINAR para confirmar"><Input value={confirm} onChange={e => setConfirm(e.target.value)} /></Field>
    </Dialog> : null}
  </div>;
}
