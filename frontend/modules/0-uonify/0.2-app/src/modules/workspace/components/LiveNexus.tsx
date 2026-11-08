import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, RefreshCw, Plus, ChevronRight, Check, Link2, X, ShieldCheck } from 'lucide-react';
import { currentAccountEmail } from '@/modules/auth';
import { GoogleCloudConnection } from '@/modules/cloud';
import { DriveConnectionSettings } from '@/modules/drive';
import { AmazonConnectionSettings, amazonReady, clearAmazonIntent, useAmazonConnection, useAmazonIntent } from '@/modules/amazon';
import { BlenderConnectionSettings, useBlenderConnection } from '@/modules/blender';
import { Dialog } from '@/shared/ui';
import { useServiceStatus } from '../hooks/serviceStatus';
import { NEXUS_APPS, type NexusApp } from '../model/nexusCatalog';
import '../styles/connection-center.css';

/** Catálogo de conexiones: disponibilidad editorial, estado y permisos del servidor. */
export function LiveNexus() {
  const account = currentAccountEmail() ?? '';
  const state = useServiceStatus();
  const amazon = useAmazonConnection(account);
  const blender = useBlenderConnection(account);
  const amazonIntent = useAmazonIntent(value => value.pending);
  const cache = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'connected'>('all');
  const [search, setSearch] = useState('');
  const [selection, setSelected] = useState<NexusApp | null>(null);
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
  const available = (app: NexusApp) => app.id === 'amazon' ? amazonReady(amazon.data) || connected(app.id) : app.available;
  const total = NEXUS_APPS.filter(app => connected(app.id)).length;
  const query = search.trim().toLocaleLowerCase('es');
  const apps = NEXUS_APPS.filter(app => `${app.name} ${app.description} ${app.category}`.toLocaleLowerCase('es').includes(query) && (filter === 'all' || connected(app.id)));
  const refresh = () => {
    void state.refetch();
    void amazon.refetch();
    void blender.refetch();
    // Al conectar o cambiar de proyecto, el chat necesita su catálogo actual.
    void cache.invalidateQueries({ queryKey: ['uony-options', account] });
  };
  const close = () => { setSelected(null); setPairDismissed(true); clearAmazonIntent(); refresh(); };
  const appRow = (app: NexusApp) => <li key={app.id} className="nxs-app">
    <button className="nxs-app-main" onClick={() => setSelected(app)} aria-label={`Ver ${app.name}`}>
      <span className={`nxs-logo nxs-logo-${app.id}`}><img src={`/assets/brands/${app.icon}`} alt="" /></span>
      <span className="nxs-app-copy"><strong>{app.name}</strong><span>{app.description}</span>
        {connected(app.id) && <small className="nxs-connected"><Check size={12} /> Conectado</small>}
        {status(app.id) === 'reauthorize' && <small>Requiere autorización</small>}
        {status(app.id) === 'offline' && <small>Equipo sin conexión</small>}
      </span>
    </button>
    {available(app) ? <button className={`nxs-app-action ${connected(app.id) ? 'is-connected' : ''}`} onClick={() => setSelected(app)} aria-label={`${connected(app.id) ? 'Gestionar' : 'Configurar'} ${app.name}`} title={`${connected(app.id) ? 'Gestionar' : 'Configurar'} ${app.name}`}>
      {connected(app.id) ? <ChevronRight size={18} /> : <Plus size={19} />}
    </button> : <button className="nxs-soon" onClick={() => setSelected(app)} aria-label={`Ver disponibilidad de ${app.name}`}>En preparación</button>}
  </li>;
  return <section className="nxs-page">
    <header className="nxs-header">
      <div><p className="nxs-eyebrow">TUS HERRAMIENTAS, CONECTADAS</p><h1>Nexus</h1><p>Todo lo que necesitas, en tu espacio Uonify.</p></div>
      <div className="nxs-tools"><label className="nxs-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Buscar conexiones" placeholder="Buscar conexiones" value={search} onChange={event => setSearch(event.target.value)} />{search && <button onClick={() => setSearch('')} aria-label="Limpiar búsqueda"><X size={14} /></button>}</label>
        <button className="nxs-icon-button" aria-label="Actualizar conexiones" title="Actualizar conexiones" disabled={state.isFetching || amazon.isFetching || blender.isFetching} onClick={refresh}><RefreshCw size={17} className={state.isFetching || amazon.isFetching || blender.isFetching ? 'nxs-spin' : ''} /></button>
      </div>
    </header>
    <nav className="nxs-filters" aria-label="Filtrar conexiones">
      <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todas</button>
      <button aria-pressed={filter === 'connected'} onClick={() => setFilter('connected')}>Conectadas <span>{total}</span></button>
    </nav>
    {state.isPending ? <p className="nxs-empty" role="status">Comprobando tus conexiones…</p> : state.isError ? <div className="nxs-empty" role="alert"><p>No hemos podido cargar tus conexiones.</p><button className="nxs-text-button" onClick={() => void state.refetch()}>Volver a intentarlo</button></div> : <>
      {apps.some(available) && <section className="nxs-group" aria-labelledby="nxs-available"><header><h2 id="nxs-available">{filter === 'connected' ? 'Tus conexiones' : 'Disponibles para ti'}</h2><span>{apps.filter(available).length}</span></header><ul className="nxs-grid">{apps.filter(available).map(appRow)}</ul></section>}
      {apps.some(app => !available(app)) && <section className="nxs-group" aria-labelledby="nxs-upcoming"><header><h2 id="nxs-upcoming">Lo próximo en Uonify</h2></header><ul className="nxs-grid">{apps.filter(app => !available(app)).map(appRow)}</ul><p className="nxs-group-note">Estas conexiones todavía no están disponibles.</p></section>}
      {!apps.length && <div className="nxs-empty" role="status"><Link2 size={24} /><h2>{search ? 'No encontramos esa conexión' : 'Tu próxima conexión empieza aquí'}</h2><p>{search ? 'Prueba con otro nombre o explora todas las herramientas.' : 'Conecta una herramienta y aparecerá en este espacio.'}</p><button className="nxs-text-button" onClick={() => { setSearch(''); setFilter('all'); }}>Ver todas las conexiones</button></div>}
    </>}
    <footer className="nxs-footer"><ShieldCheck size={16} /><span>Tú decides qué conectar. Tus permisos se gestionan con cada aplicación.</span></footer>
    <Dialog open={!!selected} onClose={close} title={selected && <span className="nxs-dialog-title"><span className={`nxs-logo nxs-logo-${selected.id}`}><img src={`/assets/brands/${selected.icon}`} alt="" /></span>{selected.name}</span>} size="md" className="nxs-dialog">
      {selected?.id === 'cloud' ? <GoogleCloudConnection account={account} /> : selected?.id === 'drive' ? <DriveConnectionSettings account={account} /> : selected?.id === 'amazon' ? <AmazonConnectionSettings account={account} intentId={amazonIntent?.id} onIntentHandled={handleIntent} /> : selected?.id === 'blender' ? <BlenderConnectionSettings key={account} account={account} pairId={blenderPair} onPairHandled={handleBlenderPair} /> : selected && <div className="nxs-unavailable"><span className="nxs-status-label">En preparación</span><h3>Una nueva forma de conectar con Uony</h3><p>Hemos solicitado esta integración a OpenAI. Estará disponible cuando se apruebe y completemos su conexión con Uonify.</p><p>No necesitas configurar nada todavía.</p></div>}
    </Dialog>
  </section>;
}
