import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/shared/ui';
import { startIncidentResolution } from '@/modules/workspace';
import { errorMessage } from '@/shared/api/client';
import { useIncident } from '../hooks/useIncidents';
import { INCIDENT_STATUS, incidentDate } from '../model/types';

export function IncidentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    // Solo al seleccionar otra incidencia, nunca por una comprobación de estado.
    panel.current?.scrollIntoView?.({ block: 'nearest' });
    panel.current?.focus({ preventScroll: true });
  }, [id]);
  const query = useIncident(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const incident = query.data?.incident;
  const resolve = async () => {
    if (busy || !incident) return;
    setBusy(true); setError('');
    try { await startIncidentResolution(id, incident.status === 'awaiting_amazon' ? 'check' : 'start'); }
    catch (failure) { setError(errorMessage(failure, 'No se ha podido abrir la corrección con Uony. Inténtalo de nuevo.')); }
    finally { setBusy(false); }
  };
  return <section ref={panel} tabIndex={-1} className="incident-detail" aria-label="Detalle de la incidencia">
    <header><h3>Detalle de la incidencia</h3><button type="button" className="incidents-icon" aria-label="Cerrar detalle" onClick={onClose}><Icon name="x" size={18} /></button></header>
    {query.isPending ? <p role="status">Cargando incidencia…</p> : query.isError ? <div role="alert"><p>{errorMessage(query.error, 'No se ha podido recuperar la incidencia.')}</p><button className="incidents-button" onClick={() => void query.refetch()}>Reintentar</button></div> : incident && <>
      <p className="incident-detail-product">{incident.productName || incident.sku}</p>
      <p className="incidents-muted">SKU {incident.sku} · {incident.marketplaceName || incident.marketplaceId}</p>
      <span className={`incident-status is-${incident.status}`}>{INCIDENT_STATUS[incident.status]}</span>
      <p className="incident-detail-message">{incident.message}</p>
      <p>{incident.severity === 'ERROR' ? 'Amazon informa de un error que requiere atención en la ficha.' : incident.severity === 'WARNING' ? 'Amazon recomienda revisar esta advertencia.' : 'Información comunicada por Amazon.'}</p>
      {!!incident.attributeNames.length && <p><strong>Campos afectados:</strong> {incident.attributeNames.join(', ')}</p>}
      {incident.status === 'awaiting_amazon' && <p className="incidents-notice">El envío todavía no acredita la corrección. Comprobaremos que Amazon la ha aplicado y que la incidencia ha desaparecido.</p>}
      {incident.status !== 'resolved' && <button type="button" className="incident-uony" disabled={busy} onClick={() => void resolve()}><Icon name="uony" size={20} />{busy ? 'Abriendo conversación…' : incident.status === 'awaiting_amazon' ? 'Comprobar con Uony' : 'Resolver con Uony'}</button>}
      {error && <p role="alert">{error}</p>}
      <p className="incidents-muted">Actualizada: {incidentDate(incident.lastSeenAt)}{incident.resolvedAt && <> · Resuelta: {incidentDate(incident.resolvedAt)}</>}</p>
      <details><summary>Respuesta de Amazon</summary><dl><dt>Código</dt><dd>{incident.code}</dd><dt>Mensaje</dt><dd>{incident.message}</dd><dt>Estado del envío</dt><dd>{incident.submissionStatus || 'Sin envío asociado'}</dd></dl></details>
      <details><summary>Historial de esta incidencia</summary>{incident.history.length ? <ol className="incident-history">{incident.history.map((entry, index) => <li key={`${entry.at}:${index}`}><time>{incidentDate(entry.at)}</time><p>{entry.message}</p></li>)}</ol> : <p>La incidencia todavía no tiene intentos de corrección.</p>}</details>
    </>}
  </section>;
}
