import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@/shared/api/client';
import { useOwnedRequest } from '@/shared/hooks';
import { currentAccountEmail } from '@/modules/auth';
import { useCloudWindow } from '@/modules/cloud';
import { driveApi, type DriveState } from '../api/driveApi';

/** Gestión de permisos en Nexus, sin pedir materiales ni repetir el onboarding. */
interface Props { account: string; onBusyChange?: (busy: boolean) => void; requireAuthorization?: boolean; onConnected?: () => void }
export function DriveConnectionSettings(props: Props) {
  return <AccountDriveConnectionSettings key={props.account} {...props} />;
}

function AccountDriveConnectionSettings({ account, onBusyChange, requireAuthorization = false, onConnected }: Props) {
  const owner = useOwnedRequest(account, currentAccountEmail);
  const state = useQuery({ queryKey: ['google-drive', account], queryFn: ({ signal }) => owner.read(inner => api.get<DriveState>('/connections/google-drive', { signal: inner }), signal), retry: false, staleTime: 0 });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const popup = useCloudWindow(async () => {
    if (!owner.current()) return;
    const result = await state.refetch({ throwOnError: true });
    if (owner.current() && result.data?.connection.status === 'connected') onConnected?.();
  }, 'google-drive');
  useEffect(() => { onBusyChange?.(busy || !!popup.pending); }, [busy, popup.pending, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const connected = state.data?.connection.status === 'connected' && !requireAuthorization;
  const disconnect = async () => {
    if (busy) return;
    const task = owner.begin(); if (!task) return;
    setBusy(true); setMessage('');
    try { await driveApi.disconnect(task.signal); task.check(); await state.refetch({ throwOnError: true }); task.check(); setConfirm(false); setMessage('Google Drive se ha desconectado. Tus archivos siguen en Google.'); }
    catch (error) { if (task.valid()) setMessage(errorMessage(error)); }
    finally { if (task.valid()) setBusy(false); task.finish(); }
  };
  return <section className="nxs-connection-detail" aria-label="Permisos de Google Drive">
    <p>Conecta tus documentos e imágenes. Elegirás los archivos cuando prepares un producto con Uony.</p>
    <div className="nxs-detail-account"><span>Cuenta de Google</span><strong>{account}</strong></div>
    {state.isPending ? <p role="status">Comprobando tu conexión…</p> : state.isError ? <p role="alert">No podemos comprobar la conexión. <button className="nxs-text-button" onClick={() => void state.refetch()}>Reintentar</button></p> : <>
      <div className="nxs-detail-status"><span>Estado</span><strong>{connected ? 'Conectado' : requireAuthorization || state.data.connection.status === 'reauthorize' ? 'Requiere autorización' : 'Sin conectar'}</strong></div>
      <h3>Permisos que autorizas</h3><ul><li>Consultar tus archivos y carpetas de Google Drive.</li><li>Gestionar los archivos que crees o uses con Uonify.</li></ul>
      <p className="nxs-detail-note">La selección de materiales se hace después. Puedes empezar un producto desde cero.</p>
      {popup.pending ? <div className="nxs-detail-actions"><p role="status">Completa el permiso en la ventana de Google. Volverás aquí automáticamente.</p><button className="nxs-primary" onClick={popup.focus}>Ver ventana de Google</button><button className="nxs-text-button" onClick={() => void popup.resume()}>Cancelar conexión</button></div> : connected ? <div className="nxs-detail-actions">
        {confirm && <p>¿Desconectar Google Drive? Tus archivos y tu trabajo se conservan. Esto no retira el permiso de tu cuenta de Google.</p>}
        <button className="nxs-text-button" disabled={busy} onClick={() => confirm ? void disconnect() : setConfirm(true)}>{busy ? 'Desconectando…' : confirm ? 'Confirmar desconexión' : 'Desconectar Google Drive'}</button>
        {confirm && <button className="nxs-text-button" disabled={busy} onClick={() => setConfirm(false)}>Mantener conexión</button>}
      </div> : <div className="nxs-detail-actions"><button className="nxs-primary" disabled={!state.data.available || !state.data.accessAllowed} onClick={() => void popup.open('authorization')}>{requireAuthorization || state.data.connection.status === 'reauthorize' ? 'Volver a autorizar Google Drive' : 'Conectar Google Drive'}</button>
        {!state.data.accessAllowed && <p>Necesitas una prueba o suscripción vigente de Uonify.</p>}
      </div>}
    </>}
    {(message || popup.message) && <p role="status">{message || popup.message}</p>}
  </section>;
}
