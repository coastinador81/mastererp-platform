import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, RefreshCw, Plus, ChevronRight, Check, Link2, X, ShieldCheck, Clock } from 'lucide-react';
import { currentAccountEmail } from '@/modules/auth';
import { GoogleCloudConnection } from '@/modules/cloud';
import { DriveConnectionSettings } from '@/modules/drive';
import { AmazonConnectionSettings, amazonReady, clearAmazonIntent, useAmazonConnection, useAmazonIntent } from '@/modules/amazon';
import { BlenderConnectionSettings, useBlenderConnection } from '@/modules/blender';
import { Dialog } from '@/shared/ui';
import { useServiceStatus } from '../hooks/serviceStatus';
import { NEXUS_APPS, NEXUS_CONNECTORS, NEXUS_FEATURED_REQUEST, NEXUS_PLATFORMS, type NexusApp, type NexusConnector } from '../model/nexusCatalog';
import { NexusRequestPanel } from './nexus/NexusRequestPanel';
import { useNexusRequests } from './nexus/nexusRequests';
import '../styles/connection-center.css';
import '../styles/nexus-request.css';

const markOf = (connector: NexusConnector) => NEXUS_PLATFORMS.find(platform => platform.id === connector.platform)?.mark ?? '+';

/** Catálogo de conexiones: flujos reales donde existen y solicitud de activación en el resto. */
export function LiveNexus() {
  const account = currentAccountEmail() ?? '';
  const state = useServiceStatus();
  const amazon = useAmazonConnection(account);
  const blender = useBlenderConnection(account);
  const amazonIntent = useAmazonIntent(value => value.pending);
  const requests = useNexusRequests(account);
  const cache = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'connected'>('all');
  const [search, setSearch] = useState('');
  const [selection, setSelected] = useState<NexusApp | null>(null);
  const [connector, setConnector] = useState<NexusConnector | null>(null);
  const [blenderPair, setBlenderPair] = useState(() => new URLSearchParams(window.location.search).get('blenderPair'));
  const [pairDismissed, setPairDismissed] = useState(false);
  const amazonApp = NEXUS_APPS.find(app => app.id === 'amazon')!;
  const blenderApp = NEXUS_APPS.find(app => app.id === 'blender')!;
  const selected = blenderPair && !pairDismissed ? blenderApp : amazonIntent ? amazonApp : selection;
  const handleIntent = () => { setSelected(amazonApp); clearAmazonIntent(); };
  const handleBlenderPair = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('blenderPair');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    setBlenderPair(null); setSelected(blenderApp);
  };
  const status = (id: string) => id === 'cloud' ? state.data?.googleCloud : id === 'drive' ? state.data?.drive : id === 'amazon' ? amazon.data?.connection?.status : id === 'blender' ? blender.data?.status : undefined;
  const connected = (id: string) => status(id) === 'connected';
  // Amazon usa su flujo real solo cuando su configuración está lista; si no, se solicita como el resto.
  const byRequest = (app: NexusApp) => app.id === 'chatgpt' || (app.id === 'amazon' && !amazonReady(amazon.data) && !connected(app.id));
  const total = NEXUS_APPS.filter(app => connected(app.id)).length;
  const query = search.trim().toLocaleLowerCase('es');
  const matches = (text: string) => text.toLocaleLowerCase('es').includes(query);
  const apps = NEXUS_APPS.filter(app => matches(`${app.name} ${app.description} ${app.category}`) && (filter === 'all' || connected(app.id)));
  const connectors = filter === 'connected' ? [] : NEXUS_CONNECTORS.filter(item => {
    const platform = NEXUS_PLATFORMS.find(entry => entry.id === item.platform)?.name ?? '';
    return matches(`${item.name} ${item.description} ${item.category} ${platform}`);
  });
  const refresh = () => {
    void state.refetch();
    void amazon.refetch();
    void blender.refetch();
    // Al conectar o cambiar de proyecto, el chat necesita su catálogo actual.
    void cache.invalidateQueries({ queryKey: ['uony-options', account] });
  };
  const close = () => { setSelected(null); setConnector(null); setPairDismissed(true); clearAmazonIntent(); refresh(); };
  const requestedNote = (id: string) => requests.isRequested(id) && <small className="nxs-requested"><Clock size={12} /> Activación solicitada</small>;
  const appRow = (app: NexusApp) => {
    const request = byRequest(app);
    const label = request ? (requests.isRequested(app.id) ? 'Ver solicitud de' : 'Activar') : connected(app.id) ? 'Gestionar' : 'Configurar';
    return <li key={app.id} className="nxs-app">
      <button className="nxs-app-main" onClick={() => setSelected(app)} aria-label={`Ver ${app.name}`}>
        <span className={`nxs-logo nxs-logo-${app.id}`}><img src={`/assets/brands/${app.icon}`} alt="" /></span>
        <span className="nxs-app-copy"><strong>{app.name}</strong><span>{app.description}</span>
          {!request && connected(app.id) && <small className="nxs-connected"><Check size={12} /> Conectado</small>}
          {!request && status(app.id) === 'reauthorize' && <small>Requiere autorización</small>}
          {!request && status(app.id) === 'offline' && <small>Equipo sin conexión</small>}
          {request && requestedNote(app.id)}
        </span>
      </button>
      <button className={`nxs-app-action ${!request && connected(app.id) ? 'is-connected' : ''}`} onClick={() => setSelected(app)} aria-label={`${label} ${app.name}`} title={`${label} ${app.name}`}>
        {!request && connected(app.id) ? <ChevronRight size={18} /> : <Plus size={19} />}
      </button>
    </li>;
  };
  const connectorRow = (item: NexusConnector) => {
    const label = requests.isRequested(item.id) ? 'Ver solicitud de' : 'Activar';
    return <li key={item.id} className="nxs-app">
      <button className="nxs-app-main" onClick={() => setConnector(item)} aria-label={`Ver ${item.name}`}>
        <span className="nxs-logo nxs-mark" aria-hidden="true">{markOf(item)}</span>
        <span className="nxs-app-copy"><strong>{item.name}</strong><span>{item.description}</span>{requestedNote(item.id)}</span>
      </button>
      <button className="nxs-app-action" onClick={() => setConnector(item)} aria-label={`${label} ${item.name}`} title={`${label} ${item.name}`}><Plus size={19} /></button>
    </li>;
  };
  const dialogTitle = connector
    ? <span className="nxs-dialog-title"><span className="nxs-logo nxs-mark" aria-hidden="true">{markOf(connector)}</span>{connector.name}</span>
    : selected && <span className="nxs-dialog-title"><span className={`nxs-logo nxs-logo-${selected.id}`}><img src={`/assets/brands/${selected.icon}`} alt="" /></span>{selected.name}</span>;
  const selectedRequest = selected && byRequest(selected) ? NEXUS_FEATURED_REQUEST[selected.id as 'amazon' | 'chatgpt'] : null;
  const fetching = state.isFetching || amazon.isFetching || blender.isFetching;
  return <section className="nxs-page">
    <header className="nxs-header">
      <div><p className="nxs-eyebrow">TUS HERRAMIENTAS, CONECTADAS</p><h1>Nexus</h1><p>Todo lo que necesitas, en tu espacio Uonify.</p></div>
      <div className="nxs-tools"><label className="nxs-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Buscar conexiones" placeholder="Buscar conexiones" value={search} onChange={event => setSearch(event.target.value)} />{search && <button onClick={() => setSearch('')} aria-label="Limpiar búsqueda"><X size={14} /></button>}</label>
        <button className="nxs-icon-button" aria-label="Actualizar conexiones" title="Actualizar conexiones" disabled={fetching} onClick={refresh}><RefreshCw size={17} className={fetching ? 'nxs-spin' : ''} /></button>
      </div>
    </header>
    <nav className="nxs-filters" aria-label="Filtrar conexiones">
      <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todas</button>
      <button aria-pressed={filter === 'connected'} onClick={() => setFilter('connected')}>Conectadas <span>{total}</span></button>
    </nav>
    {state.isPending ? <p className="nxs-empty" role="status">Comprobando tus conexiones…</p> : state.isError ? <div className="nxs-empty" role="alert"><p>No hemos podido cargar tus conexiones.</p><button className="nxs-text-button" onClick={() => void state.refetch()}>Volver a intentarlo</button></div> : <>
      {apps.length > 0 && <section className="nxs-group" aria-labelledby="nxs-available"><header><h2 id="nxs-available">{filter === 'connected' ? 'Tus conexiones' : 'Disponibles para ti'}</h2><span>{apps.length}</span></header><ul className="nxs-grid">{apps.map(appRow)}</ul></section>}
      {NEXUS_PLATFORMS.map(platform => {
        const items = connectors.filter(item => item.platform === platform.id);
        return items.length > 0 && <section key={platform.id} className="nxs-group" aria-labelledby={`nxs-platform-${platform.id}`}>
          <header><h2 id={`nxs-platform-${platform.id}`}>{platform.name}</h2><span>{items.length}</span></header>
          <p className="nxs-group-summary">{platform.summary}</p>
          <ul className="nxs-grid">{items.map(connectorRow)}</ul>
        </section>;
      })}
      {!apps.length && !connectors.length && <div className="nxs-empty" role="status"><Link2 size={24} /><h2>{search ? 'No encontramos esa conexión' : 'Tu próxima conexión empieza aquí'}</h2><p>{search ? 'Prueba con otro nombre o explora todas las herramientas.' : 'Conecta una herramienta y aparecerá en este espacio.'}</p><button className="nxs-text-button" onClick={() => { setSearch(''); setFilter('all'); }}>Ver todas las conexiones</button></div>}
    </>}
    <footer className="nxs-footer"><ShieldCheck size={16} /><span>Tú decides qué conectar. Tus permisos se gestionan con cada aplicación.</span></footer>
    <Dialog open={!!selected || !!connector} onClose={close} title={dialogTitle} size="md" className="nxs-dialog">
      {connector ? <NexusRequestPanel name={connector.name} details={connector} requested={requests.isRequested(connector.id)} onRequest={() => requests.request(connector.id)} />
        : selected && selectedRequest ? <NexusRequestPanel name={selected.name} details={selectedRequest} requested={requests.isRequested(selected.id)} onRequest={() => { requests.request(selected.id); if (amazonIntent) handleIntent(); }} />
        : selected?.id === 'cloud' ? <GoogleCloudConnection account={account} /> : selected?.id === 'drive' ? <DriveConnectionSettings account={account} /> : selected?.id === 'amazon' ? <AmazonConnectionSettings account={account} intentId={amazonIntent?.id} onIntentHandled={handleIntent} /> : selected?.id === 'blender' ? <BlenderConnectionSettings key={account} account={account} pairId={blenderPair} onPairHandled={handleBlenderPair} /> : null}
    </Dialog>
  </section>;
}
