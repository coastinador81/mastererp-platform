import { useState } from 'react';
import { Icon } from '@/shared/ui';
import { errorMessage } from '@/shared/api/client';
import { useIncidentAccount, useIncidents } from '../hooks/useIncidents';
import { filterIncidents, INCIDENT_SEVERITY, INCIDENT_STATUS, incidentDate } from '../model/types';
import { IncidentDetail } from './IncidentDetail';
import { IncidentSyncStatus } from './IncidentSyncStatus';
import '../styles/incidents.css';

interface Props { sku?: string; onViewAll?: () => void; onClose?: () => void }

export function IncidentsView(props: Props) {
  const account = useIncidentAccount();
  return account ? <OwnedIncidents key={`${account}:${props.sku ?? 'all'}`} {...props} /> : <p role="status">Inicia sesión para consultar las incidencias de tu cuenta.</p>;
}

function OwnedIncidents({ sku, onViewAll, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [severity, setSeverity] = useState('');
  const [market, setMarket] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const { query, sync, syncing, syncError } = useIncidents({ sku, status: status === 'resolved' ? 'resolved' : status === 'all' ? 'all' : 'active', marketplaceId: market || undefined }, true, true);
  const data = query.data;
  const visible = filterIncidents(data?.incidents ?? [], search, severity, ['active', 'all'].includes(status) ? '' : status, '');
  const markets = data?.connection.marketplaces ?? [...new Map(data?.incidents.map(item => [item.marketplaceId, item.marketplaceName || item.marketplaceId]) ?? []).entries()].map(([id, name]) => ({ id, name }));
  const checkedClean = data?.connection.connected && data.sync.state === 'ok' && !query.isError && !syncError;
  return <section className={`incidents-view ${sku ? 'is-product' : 'is-global'}`} aria-label={sku ? 'Incidencias del producto' : 'Todas las incidencias'}>
    <header className="incidents-heading"><div><p className="incidents-eyebrow">Amazon · seguimiento</p><h1>{sku ? 'Incidencias del producto' : 'Incidencias'}</h1><p>Revisa lo que necesita atención y resuélvelo con Uony.</p></div>
      <div className="incidents-heading-actions">{onViewAll && <button type="button" className="incidents-button" onClick={onViewAll}>Ver todas las incidencias<Icon name="arrow-right" size={15} /></button>}
        {onClose && <button type="button" className="incidents-icon" aria-label="Cerrar incidencias" onClick={onClose}><Icon name="x" size={18} /></button>}</div>
    </header>
    {query.isPending ? <p role="status" className="incidents-empty">Cargando incidencias…</p> : <>
      {query.isError && <div role="alert" className="incidents-notice"><p>{errorMessage(query.error, 'No se han podido recuperar las incidencias. No podemos confirmar su estado.')}</p><button type="button" className="incidents-button" onClick={() => void query.refetch()}>Reintentar</button></div>}
      {data && <>
        <IncidentSyncStatus data={data} syncing={syncing} error={syncError} onSync={cursor => void sync(cursor)} />
        {!market && <p className="incidents-muted">Se muestran las incidencias conocidas de todos los mercados. Cada comprobación consulta un mercado; selecciona otro para actualizar su estado.</p>}
        <div className="incidents-summary" aria-live="polite">
          <strong>{data.summary.active} {data.summary.active === 1 ? 'incidencia pendiente' : 'incidencias pendientes'}{!sku && <> en {data.summary.products} {data.summary.products === 1 ? 'producto' : 'productos'}</>}</strong>
          <span>{data.summary.blocking} errores · {data.summary.warnings} advertencias{!checkedClean && ' · Información sin confirmar'}</span>
        </div>
        <div className="incidents-filters">
          {!sku && <label className="incidents-search">Buscar producto o SKU<input type="search" value={search} placeholder="Nombre o SKU" onChange={event => setSearch(event.target.value)} /></label>}
          <label>Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="active">Pendientes</option><option value="needs_attention">Requiere corrección</option><option value="correction_ready">Corrección preparada</option><option value="awaiting_amazon">Pendiente de confirmación</option><option value="resolved">Resueltas</option><option value="all">Todas e historial</option></select></label>
          <label>Gravedad<select value={severity} onChange={event => setSeverity(event.target.value)}><option value="">Todas</option><option value="ERROR">Errores</option><option value="WARNING">Advertencias</option><option value="INFO">Información</option></select></label>
          <label>Mercado<select value={market} onChange={event => setMarket(event.target.value)}><option value="">Todos los conocidos</option>{markets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        {!visible.length ? <div className="incidents-empty" role="status"><Icon name={checkedClean ? 'check-circle' : 'info'} size={26} /><h2>{search || severity ? 'No hay coincidencias con estos filtros' : status === 'resolved' ? 'Todavía no hay incidencias resueltas' : checkedClean && !data.summary.active ? market ? 'Sin incidencias reportadas en este mercado' : 'No hay incidencias pendientes registradas' : data.incidents.length ? 'No hay incidencias en este estado' : 'Aún no podemos confirmar que no haya incidencias'}</h2><p>{checkedClean ? 'Puedes consultar el historial o volver a comprobar el estado de cada mercado en Amazon.' : 'Comprueba la conexión y completa la consulta a Amazon para conocer el estado actual.'}</p></div> : <ul className="incidents-list" aria-label="Lista de incidencias">
          {visible.map(item => <li key={item.id}><button type="button" className={`incident-row ${selected === item.id ? 'is-selected' : ''}`} aria-expanded={selected === item.id} aria-controls="incident-detail-panel" onClick={() => setSelected(item.id)}>
            <span className={`incident-severity is-${item.severity}`}><Icon name={item.severity === 'ERROR' ? 'alert-circle' : item.severity === 'WARNING' ? 'alert-triangle' : 'info'} size={18} /><span className="sr-only">{INCIDENT_SEVERITY[item.severity]}</span></span>
            <span className="incident-row-content"><strong>{item.productName || item.sku}</strong><span className="incidents-muted">{item.sku} · {item.marketplaceName || item.marketplaceId}</span><span className="incident-row-message">{item.message}</span><span className="incidents-muted">Actualizada: {incidentDate(item.lastSeenAt)}</span></span>
            <span className={`incident-status is-${item.status}`}>{INCIDENT_STATUS[item.status]}</span><Icon name="chevron-right" size={18} />
          </button></li>)}
        </ul>}
        {selected && <div id="incident-detail-panel"><IncidentDetail key={selected} id={selected} onClose={() => setSelected(null)} /></div>}
      </>}
    </>}
  </section>;
}
