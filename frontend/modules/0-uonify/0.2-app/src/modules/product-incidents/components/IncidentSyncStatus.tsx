import { Icon } from '@/shared/ui';
import { incidentDate, type IncidentList } from '../model/types';

interface Props { data: IncidentList; syncing: boolean; error: string | null; onSync: (cursor?: string) => void }

export function IncidentSyncStatus({ data, syncing, error, onSync }: Props) {
  const { sync, connection } = data;
  const marketName = sync.marketplaceName || connection.marketplaces?.find(item => item.id === (sync.marketplaceId || connection.marketplaceId))?.name || 'el mercado seleccionado';
  return <div className="incidents-sync" aria-busy={syncing}>
    <div className="incidents-sync-main">
      <p>{connection.connected ? <>Última comprobación · {marketName}: <strong>{incidentDate(sync.lastCheckedAt)}</strong></> : 'Amazon no está conectado. El historial guardado se conserva.'}</p>
      <button type="button" className="incidents-button" disabled={syncing || !connection.connected} onClick={() => onSync()}><Icon name="refresh-cw" size={15} />{syncing ? 'Consultando Amazon…' : `Comprobar en Amazon · ${marketName}`}</button>
    </div>
    {sync.state === 'never' && connection.connected && <p role="status">Todavía no hemos comprobado las incidencias en Amazon.</p>}
    {sync.state === 'partial' && <div role="status"><p>La consulta está incompleta. Las incidencias conservan su estado hasta terminar la comprobación.</p>
      {sync.nextToken && <button type="button" className="incidents-button" disabled={syncing || !connection.connected} onClick={() => onSync(sync.nextToken!)}>Continuar comprobación</button>}</div>}
    {sync.state === 'error' && <p role="alert">{sync.message || 'No se ha podido comprobar el estado en Amazon. Conservamos la última información disponible.'}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
