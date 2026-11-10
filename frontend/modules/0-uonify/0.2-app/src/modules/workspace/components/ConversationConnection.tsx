import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AccountDeletionControl, currentAccountEmail, useSession } from '@/modules/auth';
import { AmazonConversationConnection } from '@/modules/amazon';
import { GoogleCloudConnection } from '@/modules/cloud';
import { DriveConnectionSettings } from '@/modules/drive';
import { BlenderConnectionSettings } from '@/modules/blender';
import { ErpConversationConnection } from '@/modules/erp';
import { api } from '@/shared/api/client';
import { Icon } from '@/shared/ui';
import { isConnectionProvider, type ConnectionProvider } from '../model/connectionActions';
import { NEXUS_APPS } from '../model/nexusCatalog';
import '../styles/connection-center.css';
import '../styles/universal-conversation-connection.css';

interface Props { provider: ConnectionProvider; account: string }
type LocalProvider = Exclude<ConnectionProvider, 'amazon' | 'account' | 'erp'>;
interface Snapshot {
  status?: string;
  connection?: { status: string; projectId?: string | null; checks?: { ready: boolean } | null };
}
const RESOURCES = {
  cloud: { key: 'google-cloud', path: '/connections/google-cloud' },
  drive: { key: 'google-drive', path: '/connections/google-drive' },
  blender: { key: 'blender-connection', path: '/connections/blender-local' },
} as const;

/** Reutiliza los permisos de Nexus sin cambiar de página ni ejecutar acciones de IA. */
export function ConversationConnection(props: Props) {
  if (!isConnectionProvider(props.provider)) return null;
  return <AccountConnection key={`${props.account}:${props.provider}`} {...props} />;
}

function AccountConnection({ provider, account }: Props) {
  const session = useSession();
  if (!account || session.user?.email !== account || currentAccountEmail() !== account) {
    return <p className="conversation-connection-session" role="status">Recupera tu sesión para gestionar esta conexión.</p>;
  }
  if (provider === 'account') return <AccountDeletionControl account={account} presentation="conversation" />;
  if (provider === 'erp') return <ErpConversationConnection />;
  return provider === 'amazon' ? <AmazonConversationConnection account={account} /> : <ConnectionCard provider={provider} account={account} />;
}

function ConnectionCard({ provider, account }: { provider: LocalProvider; account: string }) {
  const app = NEXUS_APPS.find(item => item.id === provider)!;
  const resource = RESOURCES[provider];
  const cache = useQueryClient();
  const state = useQuery({
    queryKey: [resource.key, account],
    queryFn: ({ signal }) => {
      if (currentAccountEmail() !== account) throw new Error('Tu sesión ha cambiado.');
      return api.get<Snapshot>(resource.path, { signal });
    },
    retry: false, staleTime: 0, refetchOnWindowFocus: false,
  });
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef<string | null>(null);
  const id = useId();
  const status = state.data?.connection?.status ?? state.data?.status;
  const connected = !state.isError && status === 'connected';
  const signature = JSON.stringify([status, state.data?.connection?.projectId, state.data?.connection?.checks?.ready]);
  const refreshRelated = () => {
    if (currentAccountEmail() !== account || busy) return;
    void cache.invalidateQueries({ queryKey: ['uony-services', account] });
    if (provider === 'cloud') void cache.invalidateQueries({ queryKey: ['uony-options', account] });
  };
  useEffect(() => {
    if (!state.data || state.isError) return;
    if (previous.current !== null && previous.current !== signature && currentAccountEmail() === account) {
      void cache.invalidateQueries({ queryKey: ['uony-services', account] });
      if (provider === 'cloud') void cache.invalidateQueries({ queryKey: ['uony-options', account] });
    }
    previous.current = signature;
  }, [account, cache, provider, signature, state.data, state.isError]);
  const toggle = () => {
    if (currentAccountEmail() !== account || busy) return;
    if (expanded) {
      setExpanded(false); refreshRelated();
      requestAnimationFrame(() => trigger.current?.focus());
    } else {
      setOpened(true); setExpanded(true);
      requestAnimationFrame(() => panel.current?.focus());
    }
  };
  const label = state.isPending ? 'Comprobando conexión' : state.isError ? 'No se pudo comprobar'
    : provider === 'cloud' && connected && !state.data?.connection?.checks?.ready ? 'Proyecto por configurar'
      : connected ? 'Conectado' : status === 'offline' ? 'Equipo sin conexión' : status === 'reauthorize' ? 'Requiere autorización' : 'Sin conectar';
  return <section className="conversation-connection-card" aria-label={`Conexión con ${app.name} en esta conversación`}>
    <header className="conversation-connection-header">
      <span className={`nxs-logo nxs-logo-${provider}`}><img src={`/assets/brands/${app.icon}`} alt="" width="36" height="36" /></span>
      <div><h3>{app.name}</h3><span className="conversation-connection-state" role="status">{label}</span></div>
      {expanded && <button type="button" ref={trigger} className="conversation-connection-close" aria-label={`Cerrar configuración de ${app.name}`} aria-expanded={expanded} aria-controls={id} disabled={busy} onClick={toggle}><Icon name="x" /></button>}
    </header>
    {!expanded && <>
      <p>{provider === 'cloud' ? connected ? 'Gestiona tu cuenta de Google y el proyecto de IA sin salir de esta conversación.' : 'Configura tu cuenta de Google y el proyecto para trabajar con Uony.' : provider === 'drive' ? connected ? 'Tu Drive está conectado. Gestiona el acceso sin salir de esta conversación.' : 'Autoriza Drive aquí. Elegirás tus materiales cuando prepares un producto.' : 'Consulta y gestiona tu equipo. El trabajo 3D vive en la ficha del producto.'}</p>
      <button type="button" ref={trigger} className="conversation-connection-manage" aria-controls={id} aria-expanded={false} onClick={toggle}>Gestionar {app.name}</button>
    </>}
    {opened && <div id={id} ref={panel} className="conversation-connection-panel" tabIndex={-1} hidden={!expanded} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); toggle(); }
    }}>
      {provider === 'cloud' ? <GoogleCloudConnection account={account} onBusyChange={setBusy} /> : provider === 'drive' ? <DriveConnectionSettings account={account} onBusyChange={setBusy} /> : <BlenderConnectionSettings account={account} onBusyChange={setBusy} />}
    </div>}
  </section>;
}
