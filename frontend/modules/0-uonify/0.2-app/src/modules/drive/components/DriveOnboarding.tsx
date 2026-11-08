import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { InformationDisclosure } from '@/shared/ui';
import { useCloudWindow, GoogleAccountRule } from '@/modules/cloud';
import { driveApi } from '../api/driveApi';
import '../styles/drive.css';

/** En el alta solo se autoriza la conexión; los materiales pertenecen a la tarea del agente. */
export function DriveOnboarding({ account, onContinue, onProgress }: {
  account: string;
  onContinue: () => void | Promise<void>;
  /** Índice humano, empezando en 1; la barra general integra estos apartados. */
  onProgress?: (progress: { id: string; label: string; index: number; total: number }) => void;
}) {
  const state = useQuery({ queryKey: ['google-drive', account], queryFn: driveApi.state, retry: false, staleTime: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const popup = useCloudWindow(async () => { await state.refetch({ throwOnError: true }); }, 'google-drive');
  const connected = state.data?.connection.status === 'connected';
  useEffect(() => {
    onProgress?.({ id: connected ? 'drive-ready' : 'drive-connect', label: connected ? 'Drive preparado' : 'Conectar Drive', index: connected ? 2 : 1, total: 2 });
  }, [connected, onProgress]);
  const later = async () => {
    setSaving(true); setError('');
    try { await driveApi.defer(); await state.refetch({ throwOnError: true }); await onContinue(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setSaving(false); }
  };
  const finish = async () => {
    setSaving(true); setError('');
    try { await onContinue(); } catch (failure) { setError(errorMessage(failure)); }
    finally { setSaving(false); }
  };
  return <section className="drv-connect drv-onboarding" aria-label="Conectar Drive durante el alta">
    <p className="drv-eyebrow">GOOGLE DRIVE · OPCIONAL</p>
    <h3>{connected ? 'Drive está listo' : 'Conecta tus archivos'}</h3>
    <p>{connected ? 'Elige documentos y fotos de tu Drive para que Uony prepare tus productos, sin volver a subirlos.' : 'Conecta Drive para elegir documentos y fotos al preparar tus productos con Uony, sin subirlos de nuevo.'}</p>
    {state.isPending ? <p role="status">Comprobando tu conexión…</p> : state.isError ? <p role="alert">No podemos comprobar Drive. <button onClick={() => void state.refetch()}>Reintentar</button></p> : <>
      {connected ? <div className="drv-account"><span><strong>Google Drive conectado</strong><small>{state.data.connection.email}</small></span><span className="cld-badge">Conectado</span></div> : <p className="drv-permission">Google te pedirá permiso para consultar tus archivos y gestionar los que uses con Uonify.</p>}
      {!connected && state.data.onboardingDeferred && <p>Has elegido conectarlo más adelante. Puedes hacerlo cuando lo necesites.</p>}
    </>}
    <InformationDisclosure label="Sobre tus archivos y tu cuenta de Google">
      <GoogleAccountRule account={account} />
      <div className="drv-onboarding-note"><strong>¿Todavía no tienes imágenes o documentos?</strong><p>También puedes empezar desde cero. Uony te guiará cuando crees tu producto.</p></div>
    </InformationDisclosure>
    {popup.pending ? <div className="drv-authorize"><strong>Seguimos aquí, en Uonify</strong><p>Completa el permiso en la ventana de Google. Volverás aquí automáticamente.</p><div className="drv-actions"><button onClick={popup.focus}>Ver ventana de Google</button><button onClick={() => void popup.resume()}>Cancelar conexión</button></div></div> : <div className="drv-actions drv-onboarding-actions">
      {connected ? <button className="uon-profile-submit" disabled={saving} onClick={() => void finish()}>{saving ? 'Preparando tu espacio…' : 'Continuar'}</button> : <>
        <button className="uon-profile-submit" disabled={saving || !state.data?.available || !(state.data.accessAllowed || state.data.preparationAllowed)} onClick={() => void popup.open('authorization')}>{state.data?.connection.status === 'reauthorize' ? 'Volver a autorizar Drive' : 'Conectar Google Drive'}</button>
        <button disabled={saving} onClick={() => void later()}>{saving ? 'Guardando…' : 'Ahora no, más adelante'}</button>
      </>}
    </div>}
    {error && <p role="alert">{error}</p>}
    {popup.message && <p role="status">{popup.message}</p>}
  </section>;
}
