import { Icon } from '@/shared/ui';
import { incidentDate, type IncidentList } from '../model/types';
import '../styles/incidents.css';

interface Props {
  data?: IncidentList;
  loading: boolean;
  failed: boolean;
  compact?: boolean;
  onClick: () => void;
}

/** Resume el estado compartido del catálogo; no inicia otra consulta a Amazon. */
export function IncidentsAccessButton({ data, loading, failed, compact = false, onClick }: Props) {
  const count = data?.summary.active ?? 0;
  const clean = !!data?.connection.connected && data.sync.state === 'ok' && !!data.sync.lastCheckedAt && !failed && !loading;
  const tone = count > 0 ? 'attention' : clean ? 'clear' : 'unknown';
  const message = count > 0 ? `${count} ${count === 1 ? 'incidencia pendiente' : 'incidencias pendientes'}`
    : loading ? 'Cargando incidencias…'
    : failed ? 'No se ha podido comprobar'
    : !data?.connection.connected ? 'Conecta Amazon para comprobar'
    : clean ? 'Todo correcto, no hay incidencias'
    : data.sync.state === 'partial' ? 'Comprobación incompleta'
    : data.sync.state === 'error' ? 'No se ha podido comprobar'
    : 'Pendiente de comprobar';
  const label = `${compact ? 'Todas las incidencias' : 'Incidencias'}: ${message}`;
  const checked = data?.sync.lastCheckedAt
    ? `Última comprobación${data.sync.marketplaceName ? ` en ${data.sync.marketplaceName}` : ''}: ${incidentDate(data.sync.lastCheckedAt)}. Mercados consultados.`
    : 'Aún no hay una comprobación completa de Amazon.';
  return <button type="button" className={compact ? 'product-incidents-rail' : 'product-incidents-access'} data-state={tone}
    aria-label={label} title={`${message}. ${!clean && count > 0 ? 'Último estado conocido. ' : ''}${checked}`}
    data-tooltip={compact ? label : undefined} data-tooltip-pos={compact ? 'right' : undefined} onClick={onClick}>
    <Icon name={tone === 'clear' ? 'check-circle' : 'alert-circle'} size={compact ? 19 : 17} />
    {compact ? count > 0 && <b className="product-incidents-count" aria-hidden="true">{count}</b> : <>
      <span className="product-incidents-access-copy"><span>Incidencias</span><small aria-live="polite">{message}</small></span>
      <Icon name="arrow-right" size={14} />
    </>}
  </button>;
}
