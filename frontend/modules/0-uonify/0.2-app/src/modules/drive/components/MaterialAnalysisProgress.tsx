import type { MaterialAnalysisJob } from '../api/productMaterials';

const pauseReasons: Record<string, string> = {
  user_requested: 'Has pausado el análisis. El avance guardado se conserva.',
  budget_exhausted: 'Se ha alcanzado el presupuesto de este bloque. Puedes continuar con otro bloque conservando lo analizado.',
  consumption_unknown: 'La última llamada pudo consumir recursos. Reanudar volverá a intentar esa parte.',
  provider_error: 'El proveedor no ha podido continuar. Tus resultados están guardados; puedes reintentar la parte pendiente.',
  source_changed: 'Un archivo ha cambiado desde que empezó el análisis. Inicia un nuevo análisis para revisar la versión actual; los resultados anteriores se conservan.',
  download_limit: 'Se ha alcanzado el límite de lectura de esta pasada. Puedes reanudar para leer los archivos pendientes conservando el avance.',
  discovery_limit: 'Se ha alcanzado el límite de exploración de esta pasada. Puedes reanudar para localizar el resto de archivos y subcarpetas.',
};
const number = (value: number) => new Intl.NumberFormat('es-ES').format(value);

export function MaterialAnalysisProgress({ job }: { job: MaterialAnalysisJob }) {
  const running = ['queued', 'running'].includes(job.status);
  const upgrading = job.operation === 'upgrade_readers';
  const repairing = job.operation === 'repair_evidence';
  const reconciling = job.operation === 'reconcile' || job.stage === 'reconciling';
  const coverage = job.coverage;
  const resolution = job.resolution;
  const incomplete = job.sources.some(source => source.status === 'partial' || source.readingCoverage?.complete === false);
  const unsupported = job.sources.filter(source => ['unsupported', 'skipped'].includes(source.status)).length;
  return <>
    <div className="drive-analysis-summary"><strong>{job.folderName || 'Carpeta de Drive'}</strong>
      <span>{job.stage === 'discovering' ? 'Localizando archivos y subcarpetas…' : resolution
        ? `${number(resolution.processedSources)} de ${number(coverage?.sourcesTotal ?? job.total)} archivos procesados`
        : coverage ? `${number(coverage.sourcesRead)} de ${number(coverage.sourcesTotal)} archivos procesados`
        : `${job.processed} de ${job.total} archivos procesados`}</span>
      {resolution && <span>{number(resolution.completeSources)} de {number(coverage?.sourcesTotal ?? job.total)} archivos con lectura completa</span>}
      {coverage && <span>{number(coverage.fragmentsDone)} de {number(coverage.fragmentsTotal)} partes procesadas · {number(coverage.fragmentsPending)} pendientes de procesar</span>}
    </div>
    {job.analysisModel === 'gemini-3.5-flash-lite' && <small>Análisis con Gemini 3.5 Flash-Lite</small>}
    {running && <div role="status"><p>{reconciling ? 'Uony está comprobando las fuentes y unificando los datos…' : repairing ? 'Uony está resolviendo las comprobaciones pendientes y conservando el historial…' : upgrading ? 'Uony está ampliando la lectura visual y de los archivos nativos…' : job.status === 'queued' ? 'El análisis está en cola.' : job.stage === 'analyzing' ? 'Uony está analizando el contenido…' : 'Uony está leyendo los materiales…'} Puedes seguir usando la conversación y volver más tarde.</p>
      {reconciling && job.reconciliation?.checkedSources !== undefined && <p>{job.reconciliation.checkedSources} de {job.sources.length} fuentes comprobadas.</p>}
      {reconciling ? <progress aria-label="Comprobación de fuentes y datos" /> : coverage && job.stage !== 'discovering' ? <progress aria-label="Análisis de partes del contenido" value={coverage.fragmentsTotal ? coverage.fragmentsDone : undefined} max={Math.max(1, coverage.fragmentsTotal)} />
        : <progress aria-label="Análisis de archivos" value={job.total ? job.processed : undefined} max={Math.max(1, job.total)} />}</div>}
    {running && job.pauseRequested && <p role="status">Pausa solicitada. Uony guardará el resultado de la operación en curso antes de detenerse.</p>}
    {job.status === 'paused' && <p role="status"><strong>Análisis pausado.</strong> {pauseReasons[job.pauseReason ?? ''] ?? 'El avance está guardado. Puedes continuar desde la parte pendiente.'}</p>}
    {job.status !== 'paused' && job.canResume && job.pauseReason === 'consumption_unknown' && <p className="drive-analysis-warnings">{pauseReasons.consumption_unknown}</p>}
    {job.status === 'error' && <p role="alert">{job.error?.message || 'No se ha podido completar el análisis. Tus archivos y los datos ya guardados se conservan.'}</p>}
    {!resolution && job.status === 'ready' && incomplete && <p className="drive-analysis-warnings">Hay archivos con cobertura parcial u observaciones. Consulta su detalle; los descartes registrados no equivalen a datos que debas completar.</p>}
    {!resolution && job.status === 'ready' && !!coverage?.fragmentsPending && <p className="drive-analysis-warnings">Quedan partes pendientes de analizar. Los datos encontrados se conservan.</p>}
    {!resolution && !!unsupported && <p className="drive-analysis-warnings">{unsupported} {unsupported === 1 ? 'archivo conservado sin interpretar su contenido' : 'archivos conservados sin interpretar su contenido'}. Consulta sus formatos y motivos en «Ver archivos y estado».</p>}
    {job.budget && <details><summary>Consumo del análisis</summary><p>{number(job.budget.usedCalls)} de {number(job.budget.maxCalls)} llamadas · {number(job.budget.usedTokens)} de {number(job.budget.maxTokens)} tokens del límite actual.</p>
      {!!job.budget.unknownCalls && <p className="drive-analysis-warnings">{number(job.budget.unknownCalls)} {job.budget.unknownCalls === 1 ? 'llamada tiene' : 'llamadas tienen'} consumo pendiente de confirmar. No se contabiliza como coste cero.</p>}
      <p>Este consumo acumulado corresponde al análisis de materiales. El avance se guarda antes de continuar con otro bloque.</p></details>}
  </>;
}
