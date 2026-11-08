import { useState } from 'react';
import type { MaterialAnalysisJob, MaterialResolution } from '../api/productMaterials';
import { MaterialPagination } from './MaterialAnalysisLists';
import { MaterialSourceName } from './MaterialSourceName';

const PAGE_SIZE = 50;
const number = (value: number) => new Intl.NumberFormat('es-ES').format(value);
const sourceIssues = (resolution: MaterialResolution) => resolution.issues.filter(issue => issue.kind === 'client' && issue.status === 'awaiting_source');
const sourceCount = (resolution: MaterialResolution) => resolution.sourcePendingCount ?? sourceIssues(resolution).length;
function statusText(resolution: MaterialResolution, job: MaterialAnalysisJob) {
  if (resolution.technicalPendingCount > 0) return `${resolution.technicalPendingCount === 1 ? 'Queda' : 'Quedan'} ${number(resolution.technicalPendingCount)} ${resolution.technicalPendingCount === 1 ? 'comprobación técnica pendiente' : 'comprobaciones técnicas pendientes'}. Los datos guardados se conservan.`;
  if (job.facts?.stale) return 'Los datos esperan una nueva comprobación de sus fuentes.';
  const total = job.coverage?.sourcesTotal ?? job.total;
  const complete = job.status === 'ready' && !job.coverage?.fragmentsPending && total > 0 && resolution.completeSources === total;
  const resources = sourceCount(resolution);
  if (resources > 0) {
    const pending = [];
    if (resources > 0) pending.push(`${resources === 1 ? 'Queda' : 'Quedan'} ${number(resources)} ${resources === 1 ? 'recurso por corregir o aportar' : 'recursos por corregir o aportar'}.`);
    return `${complete ? 'Lectura completa. ' : ''}${pending.join(' ')}`;
  }
  if (job.status !== 'ready') return 'El avance está guardado. La lectura aún no se ha dado por finalizada.';
  return complete ? 'Lectura completa. Los datos están disponibles para comprobar los requisitos de Amazon.' : 'Consulta la cobertura de cada archivo antes de continuar con Amazon.';
}

/** Los descartes del registro no son preguntas nuevas ni fallos de lectura activos. */
export function MaterialResolutionSummary({ job }: { job: MaterialAnalysisJob }) {
  const [page, setPage] = useState(0);
  const [sourcePage, setSourcePage] = useState(0);
  const resolution = job.resolution;
  if (!resolution) return null;
  const pending = resolution.issues.filter(issue => issue.kind !== 'client' && ['pending', 'awaiting_client'].includes(issue.status));
  const current = Math.min(page, Math.max(0, Math.ceil(pending.length / PAGE_SIZE) - 1));
  const resources = sourceIssues(resolution);
  const currentSource = Math.min(sourcePage, Math.max(0, Math.ceil(resources.length / PAGE_SIZE) - 1));
  const sources = new Map(job.sources.map(source => [source.id, source]));
  const terminal = ['ready', 'paused', 'error'].includes(job.status);
  return <div className="drive-resolution">
    {terminal && <p className={resolution.technicalPendingCount > 0 ? 'drive-analysis-warnings' : undefined} role="status">{statusText(resolution, job)}</p>}
    {!!pending.length && <details><summary>Qué falta por resolver · {number(resolution.technicalPendingCount)}</summary>
      <ul>{pending.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(issue => <li key={issue.id}>
        <strong>{issue.title}</strong>{issue.sourceId && <small><MaterialSourceName source={sources.get(issue.sourceId)} /></small>}
        <p>{issue.detail}</p>
      </li>)}</ul>
      <MaterialPagination page={current} total={pending.length} label="Páginas de comprobaciones pendientes" onChange={setPage} />
    </details>}
    {sourceCount(resolution) > 0 && <details open><summary>Recursos por corregir o aportar · {number(sourceCount(resolution))}</summary>
      <p>Uony necesita estos recursos corregidos para continuar. Las preguntas sobre los atributos se muestran por separado.</p>
      <ul>{resources.slice(currentSource * PAGE_SIZE, (currentSource + 1) * PAGE_SIZE).map(issue => <li key={issue.id}>
        <strong>{issue.title}</strong>{issue.sourceId && <small><MaterialSourceName source={sources.get(issue.sourceId)} /></small>}
        <p>{issue.detail || issue.reason}</p>
        {issue.action === 'replace_source' && <p>Siguiente paso: corrige o aporta este recurso en la carpeta de Drive y solicita un nuevo análisis a Uony.</p>}
      </li>)}</ul>
      <MaterialPagination page={currentSource} total={resources.length} label="Páginas de recursos por corregir o aportar" onChange={setSourcePage} />
    </details>}
    {(resolution.discardedProposalCount > 0 || resolution.historicalRejectionCount > 0 || resolution.resolvedCount > 0) && <details className="drive-resolution-history"><summary>Historial de la revisión</summary>
      {!!resolution.resolvedCount && <p>{number(resolution.resolvedCount)} {resolution.resolvedCount === 1 ? 'revisión resuelta' : 'revisiones resueltas'}.</p>}
      {!!resolution.discardedProposalCount && <p>{number(resolution.discardedProposalCount)} {resolution.discardedProposalCount === 1 ? 'propuesta descartada' : 'propuestas descartadas'}. Se conservan sus motivos y no se incorporan a la ficha.</p>}
      {!!resolution.historicalRejectionCount && <p>{number(resolution.historicalRejectionCount)} {resolution.historicalRejectionCount === 1 ? 'descarte registrado' : 'descartes registrados'} en análisis anteriores.</p>}
      <p>Este historial no añade preguntas al cliente. Las comprobaciones todavía abiertas aparecen por separado.</p>
    </details>}
  </div>;
}
