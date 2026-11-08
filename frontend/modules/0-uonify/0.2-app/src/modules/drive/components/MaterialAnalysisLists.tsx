import { useState } from 'react';
import { customerLocation } from '@/shared/lib/customerText';
import type { MaterialAnalysisJob, MaterialSource } from '../api/productMaterials';
import { MaterialReadingDetails } from './MaterialReadingDetails';
import { MaterialSourceName } from './MaterialSourceName';

const PAGE_SIZE = 50;
const sourceStates: Record<string, string> = {
  queued: 'En cola', pending: 'Pendiente', running: 'Analizando', processing: 'Analizando',
  analyzed: 'Analizado', analysed: 'Analizado', ready: 'Analizado', extracted: 'Leído', read: 'Leído, análisis pendiente',
  skipped: 'Sin analizar', unsupported: 'Formato conservado, sin analizar', error: 'No se pudo analizar',
  reading: 'Leyendo', awaiting_analysis: 'Preparado para analizar', partial: 'Análisis parcial', duplicate: 'Duplicado de otro archivo',
};
function sourceState(source: MaterialSource) {
  const resolution = source.resolutionSummary;
  if (!resolution) return sourceStates[source.status] ?? 'Por revisar';
  if (resolution.technicalPendingCount > 0) return `${resolution.technicalPendingCount} ${resolution.technicalPendingCount === 1 ? 'comprobación pendiente' : 'comprobaciones pendientes'}`;
  if (['partial', 'analyzed', 'analysed', 'ready'].includes(source.status)) return source.readingCoverage?.complete === true ? 'Lectura completa' : 'Procesado · consulta la cobertura';
  return sourceStates[source.status] ?? 'Por revisar';
}
export function MaterialPagination({ page, total, label, onChange }: { page: number; total: number; label: string; onChange: (value: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  return <nav className="drive-analysis-pages" aria-label={label}>
    <button type="button" disabled={!page} onClick={() => onChange(page - 1)}>Anterior</button>
    <span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}</span>
    <button type="button" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => onChange(page + 1)}>Siguiente</button>
  </nav>;
}
export function MaterialSourceList({ sources }: { sources: MaterialSource[] }) {
  const [page, setPage] = useState(0);
  const current = Math.min(page, Math.max(0, Math.ceil(sources.length / PAGE_SIZE) - 1));
  if (!sources.length) return null;
  return <details><summary>Ver archivos y estado · {sources.length}</summary>
    <ul className="drive-analysis-sources">{sources.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(source => <li key={source.id}><MaterialSourceName source={source} /><small>{sourceState(source)}{(!source.resolutionSummary || source.resolutionSummary.technicalPendingCount > 0) && (source.reason || source.message) ? ` · ${source.reason || source.message}` : ''}</small>
      {source.summary && <p>{source.summary}</p>}
      {source.image && <small>Original: {source.image.width} × {source.image.height} px. Copia para el análisis: {source.image.analysisWidth} × {source.image.analysisHeight} px. El original se conserva.</small>}
      <MaterialReadingDetails source={source} />
      {source.resolutionSummary && !!source.warnings?.length ? <details><summary>Observaciones registradas</summary>{source.warnings.map((warning, index) => <small key={index}>{warning}</small>)}</details> : source.warnings?.map((warning, index) => <small key={index}>{warning}</small>)}
    </li>)}</ul><MaterialPagination page={current} total={sources.length} label="Páginas de archivos analizados" onChange={setPage} />
  </details>;
}
export function MaterialProposalList({ job }: { job: MaterialAnalysisJob }) {
  const [page, setPage] = useState(0);
  const current = Math.min(page, Math.max(0, Math.ceil(job.proposals.length / PAGE_SIZE) - 1));
  const sources = new Map(job.sources.map(source => [source.id, source]));
  if (!job.proposals.length) return null;
  return <details><summary>Ver propuestas y sus fuentes · {job.proposals.length}</summary>
    <dl className="drive-analysis-proposals">{job.proposals.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(item => <div key={item.id}><dt>{item.label} <small>{item.status === 'confirmed' ? 'Confirmado' : item.status === 'rejected' ? 'Descartado' : 'Dato encontrado'}</small></dt><dd>{item.status === 'confirmed' ? item.confirmedValue ?? item.value : item.value}</dd><dd>{item.evidence.map((evidence, index) => <p key={index}><strong><MaterialSourceName source={sources.get(evidence.sourceId)} />{customerLocation(evidence.locator) && <> · {customerLocation(evidence.locator)}</>}</strong><q>{evidence.excerpt}</q></p>)}</dd></div>)}</dl>
    <MaterialPagination page={current} total={job.proposals.length} label="Páginas de propuestas del análisis" onChange={setPage} />
  </details>;
}
