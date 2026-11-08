import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { Button, Field, Input, type DialogControls } from '@/shared/ui';
import { useOwnedRequest } from '@/shared/hooks';
import { deleteAccount, getAccountDeletion } from '../api/accountDeletion';
import { completeSignOut } from '../flows/account';
import { currentAccountEmail } from '../state/session';
import '../styles/account-deletion.css';

export function AccountDeletionConfirmation({ account, controls }: { account: string; controls: DialogControls }) {
  const owned = useOwnedRequest(account, currentAccountEmail);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const [reviewRequired, setReviewRequired] = useState(false);
  const lock = useRef(false);
  const preview = useQuery({ queryKey: ['account', 'deletion', account],
    queryFn: ({ signal }) => owned.read(next => getAccountDeletion(next), signal),
    staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false });
  const data = preview.data;
  const matches = data?.email === account && currentAccountEmail() === account;
  const canDelete = !!data?.requestId && matches && !preview.isError && !preview.isPending && !reviewRequired && !data.blockers.length
    && (data.status === 'ready' || data.canRetry && ['pending', 'error'].includes(data.status));
  useLayoutEffect(() => { controls.update({ dismissible: !busy }); }, [busy, controls]);
  const refresh = async () => {
    if (busy || !owned.current()) return;
    setConfirmation(''); setError(''); setReviewRequired(true);
    const result = await preview.refetch();
    if (owned.current() && !result.isError) setReviewRequired(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || busy || preview.isFetching || confirmation !== 'ELIMINAR' || !canDelete || !data?.requestId) return;
    const task = owned.begin(undefined, 120_000);
    if (!task) return;
    lock.current = true; setBusy(true); setAttempted(true); setError('');
    try {
      const result = await deleteAccount({ requestId: data.requestId, confirmation: 'ELIMINAR', email: account }, task.signal);
      task.check();
      if (result.status === 'deleted') {
        await completeSignOut(account);
        return;
      }
      setError(result.message || 'La eliminación todavía no se ha completado. Tu cuenta y tus datos se conservan.');
      setConfirmation(''); setReviewRequired(true);
      await preview.refetch();
      if (task.valid()) setReviewRequired(false);
    } catch (reason) {
      if (task.valid()) {
        setError(errorMessage(reason, 'No hemos podido confirmar la eliminación. Revisa el estado antes de volver a intentarlo.'));
        setReviewRequired(true); setConfirmation('');
      }
    } finally {
      task.finish(); lock.current = false;
      if (task.valid()) setBusy(false);
    }
  };
  return <form className="account-deletion-form" onSubmit={event => void submit(event)} aria-busy={busy}>
    <p>Vas a eliminar la cuenta <strong>{account}</strong>. Esta acción es permanente e inmediata cuando se complete.</p>
    <p>Se borrarán de Uonify tus productos, conversaciones, proyectos, datos de alta y conexiones guardadas.</p>
    <p>Los archivos de Google Drive, los recursos y saldos de Google Cloud y los productos de Amazon se conservarán en esos servicios.</p>
    <p>Se cancelará inmediatamente tu suscripción a Uonify. Si vuelves a registrarte, empezarás con una cuenta nueva; eliminar la cuenta no restablece una prueba gratuita ya utilizada.</p>
    <p>Antes de cerrar la cuenta, cancelaremos también los procesos de pago abiertos. Si no podemos confirmarlo, conservaremos tu cuenta y podrás reintentarlo.</p>
    {preview.isPending || preview.isFetching ? <p role="status">Comprobando tu cuenta…</p> : preview.isError ? <div role="alert"><p>{errorMessage(preview.error, 'No podemos comprobar tu cuenta.')}</p></div> : matches && data ? <>
      <dl className="account-deletion-counts"><div><dt>Productos</dt><dd>{data.counts.products}</dd></div><div><dt>Conversaciones</dt><dd>{data.counts.conversations}</dd></div><div><dt>Conexiones</dt><dd>{data.counts.connections}</dd></div></dl>
      {data.status !== 'ready' && <p role="status">{data.message}</p>}
      {!!data.blockers.length && <ul className="account-deletion-problems">{data.blockers.map(item => <li key={item.code}>{item.message}</li>)}</ul>}
    </> : <p role="alert">La cuenta ha cambiado. Cierra esta confirmación y vuelve a abrirla con la cuenta correcta.</p>}
    <Field label="Escribe ELIMINAR para confirmar" hint="Solo se eliminará esta cuenta de Uonify.">
      <Input autoComplete="off" spellCheck={false} value={confirmation} disabled={busy || !canDelete || preview.isFetching} onChange={event => setConfirmation(event.target.value)} />
    </Field>
    {error && <p role="alert" className="account-deletion-error">{error}</p>}
    {(attempted || data?.status === 'pending' || data?.status === 'error') && !busy && <p>Cerrar esta ventana no cancela una eliminación ya confirmada.</p>}
    {busy && <p role="status">Eliminando tu cuenta. Espera a que confirmemos el resultado.</p>}
    <div className="account-deletion-actions"><Button disabled={busy} onClick={() => controls.close()}>{attempted || data?.status === 'pending' || data?.status === 'error' ? 'Cerrar' : 'Cancelar'}</Button>
      {(preview.isError || reviewRequired || data?.status !== 'ready') && <Button disabled={busy || preview.isFetching} onClick={() => void refresh()}>Comprobar de nuevo</Button>}
      <Button variant="danger" type="submit" disabled={busy || preview.isFetching || !canDelete || confirmation !== 'ELIMINAR'} loading={busy}>{busy ? 'Eliminando…' : 'Eliminar mi cuenta definitivamente'}</Button>
    </div>
  </form>;
}
