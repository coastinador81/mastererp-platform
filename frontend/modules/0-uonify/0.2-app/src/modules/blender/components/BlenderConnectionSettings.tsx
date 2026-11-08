import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { useOwnedRequest } from '@/shared/hooks';
import { currentAccountEmail } from '@/modules/auth';
import { blenderApi } from '../api/blenderApi';
import { blenderConnectionKey } from '../hooks/useBlenderConnection';
import '../styles/blender.css';

interface Props { account: string; pairId?: string | null; onPairHandled?: () => void; onBusyChange?: (busy: boolean) => void }
const dateLabel = (date: string | null) => date && Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date)) : 'Sin registro';

export function BlenderConnectionSettings(props: Props) {
  return <AccountBlenderConnectionSettings key={props.account} {...props} />;
}

function AccountBlenderConnectionSettings({ account, pairId, onPairHandled, onBusyChange }: Props) {
  const owner = useOwnedRequest(account, currentAccountEmail);
  const state = useQuery({ queryKey: blenderConnectionKey(account), queryFn: ({ signal }) => owner.read(inner => blenderApi.state(undefined, inner), signal), enabled: !!account, retry: false, staleTime: 0, refetchInterval: 15_000 });
  const pair = useQuery({ queryKey: ['blender-pair', account, pairId], queryFn: ({ signal }) => owner.read(inner => blenderApi.pair(pairId!, inner), signal), enabled: !!pairId, retry: false, gcTime: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const paired = state.data?.status === 'connected' || state.data?.status === 'offline';
  const connected = state.data?.status === 'connected';
  const version = state.data?.blenderVersion?.trim();
  const versionLabel = version && version !== 'unknown' ? version : '· versión por comprobar';
  const pairValid = !!pair.data && Date.parse(pair.data.expiresAt) > now;
  const access = state.data?.accessAllowed === true;
  useEffect(() => {
    const expiry = Date.parse(pair.data?.expiresAt ?? '');
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [pair.data?.expiresAt]);
  const connect = async () => {
    if (!pairId || !pairValid || !access || busy) return;
    const task = owner.begin(); if (!task) return;
    setBusy(true); setMessage('');
    try { await blenderApi.connect(pairId, task.signal); task.check(); await state.refetch({ throwOnError: true }); task.check(); onPairHandled?.(); setMessage('Este equipo ya está vinculado con tu cuenta de Uonify.'); }
    catch (error) { if (task.valid()) setMessage(errorMessage(error)); }
    finally { if (task.valid()) setBusy(false); task.finish(); }
  };
  const disconnect = async () => {
    if (busy) return;
    const task = owner.begin(); if (!task) return;
    setBusy(true); setMessage('');
    try { await blenderApi.disconnect(task.signal); task.check(); await state.refetch({ throwOnError: true }); task.check(); setConfirm(false); setMessage('Blender se ha desconectado de Uonify.'); }
    catch (error) { if (task.valid()) setMessage(errorMessage(error)); }
    finally { if (task.valid()) setBusy(false); task.finish(); }
  };
  return <section className="nxs-connection-detail bln-connection" aria-label="Conexión de Blender local">
    <p>Gestiona tu conexión con Blender. Puedes pedir a Uony que consulte la escena o prepare una vista previa. También puedes abrir la pestaña 3D de Producto cuando quieras.</p>
    <div className="nxs-detail-account"><span>Cuenta de Uonify</span><strong>{account}</strong></div>
    {state.isPending ? <p role="status">Comprobando Blender…</p> : state.isError ? <p role="alert">No podemos comprobar Blender. <button className="nxs-text-button" onClick={() => void state.refetch()}>Reintentar conexión</button></p> : <>
      <div className="nxs-detail-status"><span>Estado</span><strong>{connected ? 'Conectado' : paired ? 'Equipo sin conexión' : 'Sin conectar'}</strong></div>
      {paired && <div className="nxs-detail-account"><span>Tu equipo</span><strong>{state.data.deviceName}</strong><span>Blender {versionLabel}</span><span>Última comunicación con tu equipo: {dateLabel(state.data.lastSeenAt)}</span></div>}
      {pairId ? <div className="nxs-detail-account"><span>Solicitud de conexión</span>
        {pair.isPending ? <p role="status">Comprobando el equipo…</p> : pair.isError ? <p role="alert">{errorMessage(pair.error, 'Esta solicitud no está disponible. Vuelve a abrir el conector local de Uonify.')}</p> : !pairValid ? <p role="alert">La solicitud ha caducado. Vuelve a abrir el conector local de Uonify.</p> : <><strong>{pair.data?.deviceName}</strong><p>Conecta este equipo a tu cuenta para permitir que Uonify y Uony consulten su escena y soliciten vistas previas.</p><p>La solicitud caduca el {dateLabel(pair.data?.expiresAt ?? null)}.</p><button className="nxs-primary" disabled={busy || !access} onClick={() => void connect()}>{busy ? 'Conectando…' : 'Conectar este equipo'}</button></>}
        <button className="nxs-text-button" disabled={busy} onClick={onPairHandled}>Descartar solicitud</button>
      </div> : !connected && <p>{paired ? 'Abre Blender, inicia su complemento MCP y mantén abierto el conector de Uonify.' : 'Abre el conector local de Uonify en tu Mac para vincular este equipo. Mantén Blender abierto mientras trabajas desde Uonify.'}</p>}
      {!access && <p>Necesitas una prueba o suscripción vigente de Uonify para usar esta conexión.</p>}
      <h3>Permisos que autorizas</h3>
      <ul><li>Consultar la escena abierta y sus objetos.</li><li>Preparar una vista previa de hasta 320 px.</li></ul>
      <p>La conexión usa tu Blender local. Tus archivos permanecen en tu ordenador; Uonify recibe la información de la escena y las vistas previas solicitadas.</p>
      {paired && !pairId && <div className="nxs-detail-actions">
        {confirm && <p>¿Desconectar Blender de Uonify? Tus archivos se conservan en tu ordenador.</p>}
        <button className="nxs-text-button" disabled={busy} onClick={() => confirm ? void disconnect() : setConfirm(true)}>{busy ? 'Espera…' : confirm ? 'Confirmar desconexión' : 'Desconectar Blender'}</button>
        {confirm && <button className="nxs-text-button" disabled={busy} onClick={() => setConfirm(false)}>Mantener conexión</button>}
      </div>}
      {state.data.usage && <details className="bln-usage"><summary>Actividad de esta conexión</summary><dl className="bln-scene"><div><dt>Solicitudes</dt><dd>{state.data.usage.calls}</dd></div><div><dt>Datos enviados</dt><dd>{state.data.usage.requestBytes.toLocaleString('es-ES')} bytes</dd></div><div><dt>Datos recibidos</dt><dd>{state.data.usage.responseBytes.toLocaleString('es-ES')} bytes</dd></div><div><dt>Vistas previas guardadas</dt><dd>{state.data.usage.storedPreviewBytes.toLocaleString('es-ES')} bytes</dd></div></dl></details>}
    </>}
    {message && <p role="status">{message}</p>}
    <p className="bln-cost">Incluido en tu suscripción. Blender se ejecuta en tu ordenador. El consumo de IA sigue las condiciones de tu proveedor.</p>
    <a className="nxs-text-button" href="https://www.blender.org/" target="_blank" rel="noopener noreferrer">Acerca de Blender</a>
  </section>;
}
