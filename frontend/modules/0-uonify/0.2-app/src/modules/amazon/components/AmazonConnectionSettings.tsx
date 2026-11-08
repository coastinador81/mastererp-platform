import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '@/shared/api/client';
import { InformationDisclosure } from '@/shared/ui';
import { amazonApi } from '../api/amazonApi';
import { useAmazonConnection } from '../hooks/useAmazonConnection';
import { useAmazonWindow, type AmazonConnectionPlacement } from '../hooks/useAmazonWindow';
import { amazonReady } from '../model/authorization';

interface Props {
  account: string;
  intentId?: string | null;
  onIntentHandled?: () => void;
  placement?: AmazonConnectionPlacement;
  onBusyChange?: (busy: boolean) => void;
}

export function AmazonConnectionSettings(props: Props) {
  return <AccountConnectionSettings key={props.account} {...props} />;
}

function AccountConnectionSettings({ account, intentId, onIntentHandled, placement = 'nexus', onBusyChange }: Props) {
  const state = useAmazonConnection(account);
  const intent = useQuery({ queryKey: ['amazon-intent', account, intentId], queryFn: ({ signal }) => amazonApi.intent(intentId!, signal), enabled: !!intentId, retry: false, gcTime: 0 });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now);
  const resultFocus = useRef<HTMLParagraphElement>(null);
  const wasPending = useRef(false);
  const lifetime = useRef({ mounted: true, generation: 0 });
  const disconnecting = useRef(false);
  useEffect(() => {
    const current = lifetime.current;
    current.mounted = true;
    return () => { current.mounted = false; current.generation += 1; };
  }, []);
  const isCurrent = (generation: number) => lifetime.current.mounted && lifetime.current.generation === generation;
  const destination = placement === 'conversation' ? 'esta conversación' : 'Nexus';
  const expiresAt = intent.data?.expiresAt;
  useEffect(() => {
    const expires = Date.parse(expiresAt ?? '');
    if (!Number.isFinite(expires)) return;
    const timer = setTimeout(() => {
      setNow(Date.now());
      setMessage(`La solicitud de Amazon ha caducado. Vuelve a iniciarla desde Amazon o conecta tu cuenta desde ${destination}.`);
      onIntentHandled?.();
    }, Math.max(0, expires - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt, onIntentHandled, destination]);
  const popup = useAmazonWindow(async () => {
    const generation = lifetime.current.generation;
    if (!isCurrent(generation)) return;
    const latest = await state.refetch({ throwOnError: true });
    if (!isCurrent(generation)) return;
    if (latest.data?.connection.status !== 'connected') throw new Error('No se ha confirmado la conexión con Amazon.');
    window.dispatchEvent(new CustomEvent('uonify:amazon-connection-changed', { detail: { account } }));
  }, state.data?.setup?.loginUri, placement);
  const pending = Boolean(popup.pending);
  useEffect(() => { onBusyChange?.(pending || busy); }, [pending, busy, onBusyChange]);
  useEffect(() => {
    if (wasPending.current && !pending) resultFocus.current?.focus();
    wasPending.current = pending;
  }, [pending]);
  const connected = state.data?.connection?.status === 'connected';
  const ready = amazonReady(state.data);
  const intentValid = !intentId || Boolean(intent.data && Date.parse(intent.data.expiresAt) > now);
  const disabled = !ready || !state.data?.accessAllowed || !intentValid || busy;
  const connect = async () => {
    if (disabled || (intent.data && Date.parse(intent.data.expiresAt) <= Date.now())) return;
    setMessage('');
    const generation = lifetime.current.generation;
    if (await popup.open(intentId ?? undefined) && isCurrent(generation)) onIntentHandled?.();
  };
  const disconnect = async () => {
    if (disconnecting.current) return;
    const generation = lifetime.current.generation;
    disconnecting.current = true;
    setBusy(true); setMessage('');
    try {
      await amazonApi.disconnect();
      // No consultar con la sesión nueva bajo la clave de la cuenta anterior.
      if (!isCurrent(generation)) return;
      const latest = await state.refetch({ throwOnError: true });
      if (!isCurrent(generation)) return;
      if (latest.data?.connection.status !== 'disconnected') throw new Error('No se ha confirmado la desconexión con Amazon. Comprueba su estado antes de volver a intentarlo.');
      window.dispatchEvent(new CustomEvent('uonify:amazon-connection-changed', { detail: { account } }));
      setConfirm(false);
      setMessage('Amazon se ha desconectado de Uonify. Puedes retirar también la autorización desde Seller Central.');
    } catch (error) { if (isCurrent(generation)) setMessage(errorMessage(error)); }
    finally {
      disconnecting.current = false;
      if (isCurrent(generation)) setBusy(false);
    }
  };
  return <section className={`nxs-connection-detail${placement === 'conversation' ? ' amz-conversation-settings' : ''}`} aria-label="Permisos de Amazon Seller Central">
    {placement === 'nexus' && <p>Autoriza tu cuenta de vendedor para trabajar con tus fichas de producto en Uonify.</p>}
    <div className="nxs-detail-account amz-detail-identity"><span>Cuenta de Uonify</span><strong>{account}</strong></div>
    {state.isPending ? <p role="status">Comprobando tu conexión con Amazon…</p> : state.isError ? <p role="alert">No podemos comprobar Amazon. <button className="nxs-text-button" onClick={() => void state.refetch()}>Reintentar</button></p> : <>
      {placement === 'nexus' && <div className="nxs-detail-status"><span>Estado</span><strong>{connected ? 'Conectado' : 'Sin conectar'}</strong></div>}
      {connected && <div className="nxs-detail-account amz-detail-identity"><span>Cuenta de vendedor</span><strong>{state.data.connection.sellerId}</strong></div>}
      {intentId && <div className="nxs-detail-account">
        <span>Solicitud desde Amazon</span>
        {intent.isPending ? <p role="status">Comprobando la solicitud…</p> : intent.isError || !intentValid ? <p role="alert">La solicitud de Amazon no está disponible o ha caducado. Vuelve a iniciar la conexión desde Amazon.</p> : <>
          <strong>{intent.data?.sellerId}</strong><p>Confirma que quieres conectar esta cuenta de vendedor con tu cuenta de Uonify.</p>
          {connected && <p>Revisa la cuenta de vendedor antes de continuar: ya tienes una conexión con Amazon.</p>}
        </>}
      </div>}
      <ConnectionPermissions placement={placement} connected={connected} />
      {!ready && <div className="nxs-detail-account"><span>Configuración pendiente</span><p>Amazon todavía no está disponible para conectar. Uonify debe terminar su configuración segura antes de pedirte autorización.</p></div>}
      {!state.data.accessAllowed && <p>Necesitas una prueba o suscripción vigente de Uonify para conectar Amazon.</p>}
      {popup.pending ? <div className="nxs-detail-actions"><p role="status">Completa la autorización en la ventana de Amazon. Tu trabajo se conserva en {destination}; volverás aquí al terminar.</p><button className="nxs-primary" onClick={popup.focus}>Ver ventana de Amazon</button><button className="nxs-text-button" onClick={() => void popup.cancel()}>Cancelar conexión</button></div> : intentId || !connected ? <div className="nxs-detail-actions">
        {ready && <button className="nxs-primary" disabled={disabled} onClick={() => void connect()}>{intentId ? 'Confirmar y continuar en Amazon' : 'Conectar Amazon'}</button>}
        {intentId && <button className="nxs-text-button" onClick={onIntentHandled}>Cancelar solicitud</button>}
      </div> : <div className="nxs-detail-actions">
        {confirm && <p role="status">¿Desconectar Amazon de Uonify? Tu trabajo se conserva. Esta acción no retira el permiso en Seller Central.</p>}
        <button className="nxs-text-button" disabled={busy} onClick={() => confirm ? void disconnect() : setConfirm(true)}>{busy ? 'Desconectando…' : confirm ? 'Confirmar desconexión' : 'Desconectar Amazon'}</button>
        {confirm && <button className="nxs-text-button" disabled={busy} onClick={() => setConfirm(false)}>Mantener conexión</button>}
      </div>}
      {!popup.pending && !confirm && <button className="nxs-text-button amz-check-connection" disabled={busy || state.isFetching} onClick={() => void state.refetch()}>{state.isFetching ? 'Comprobando…' : 'Comprobar conexión'}</button>}
    </>}
    {(message || popup.message) && <p ref={resultFocus} tabIndex={-1} role="status">{message || popup.message}</p>}
  </section>;
}

function ConnectionPermissions({ placement, connected }: { placement: AmazonConnectionPlacement; connected: boolean }) {
  const content = <>
    <h3>Permisos que autorizas</h3>
    <ul><li>Consultar el catálogo y los requisitos de tus fichas.</li><li>Preparar y gestionar publicaciones tras tu aprobación.</li><li>Enviar avisos sobre tu trabajo a Seller Central cuando estén disponibles.</li></ul>
    <InformationDisclosure><p>No solicitamos datos personales de compradores. Conectar la cuenta no publica ningún producto.</p></InformationDisclosure>
  </>;
  return placement === 'nexus' ? content : <details className="amz-permission-details" open={!connected}>
    <summary>Permisos y uso de la conexión</summary>
    {content}
  </details>;
}
