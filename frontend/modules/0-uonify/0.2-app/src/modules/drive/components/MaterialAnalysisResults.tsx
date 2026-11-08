import { Icon, InformationDisclosure } from '@/shared/ui';
import type { MaterialAnalysisJob } from '../api/productMaterials';
import { MaterialAnalysisProgress } from './MaterialAnalysisProgress';
import { MaterialProposalList, MaterialSourceList } from './MaterialAnalysisLists';
import { MaterialCanonicalFacts } from './MaterialCanonicalFacts';
import { MaterialResolutionSummary } from './MaterialResolutionSummary';

interface Props { job: MaterialAnalysisJob; disabled: boolean; onReview: () => void; onReconcile?: () => void; onRecheck?: () => void; reconcileDisabled?: boolean }
export function MaterialAnalysisResults({ job, disabled, onReview, onReconcile, onRecheck, reconcileDisabled }: Props) {
  const facts = job.facts?.version === 1 ? job.facts : undefined;
  const reviewable = ['ready', 'paused', 'error'].includes(job.status);
  const reviewBlocked = disabled || !!facts?.stale || ['reconcile', 'upgrade_readers', 'repair_evidence'].includes(job.operation ?? '') || ['permission_denied', 'reauthorize'].includes(job.error?.code ?? '');
  return <div className="drive-analysis-results">
    <MaterialAnalysisProgress job={job} />
    <MaterialResolutionSummary job={job} />
    {!!job.warnings.length && <details className={job.resolution ? 'drive-resolution-history' : 'drive-analysis-warnings'}><summary>{job.warnings.length} {job.warnings.length === 1 ? 'observación registrada durante el análisis' : 'observaciones registradas durante el análisis'}</summary>{job.resolution && <p>Registro de la lectura. El estado actual y las acciones pendientes se muestran arriba.</p>}<ul>{job.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    <MaterialSourceList key={job.id} sources={job.sources} />
    {reviewable && <>
      {job.status === 'error' && <p>{job.canResume ? 'Análisis incompleto. Puedes revisar los datos encontrados y reanudar desde la parte pendiente.' : 'Análisis incompleto. Puedes revisar los datos encontrados o volver a analizar la carpeta.'}</p>}
      {facts ? <>
        <p>Uony aprovechará los datos de tus documentos y solo te preguntará por lo que no pueda completar para Amazon.</p>
        <InformationDisclosure label="Cómo se utilizan tus documentos"><p>Los datos encontrados conservan su fuente. Uony los contrasta con los requisitos de la categoría de Amazon y mantiene los que ya has confirmado.</p></InformationDisclosure>
        {facts.stale && <p className="drive-analysis-warnings">Las fuentes han cambiado o necesitan volver a comprobarse. Conservamos los datos anteriores, pero no se pueden confirmar hasta completar la verificación.</p>}
        <MaterialCanonicalFacts key={`${job.id}:${facts.version}`} job={job} />
        {onRecheck && <button type="button" className="drive-analysis-recheck" disabled={(reconcileDisabled ?? disabled) || ['reconcile', 'upgrade_readers', 'repair_evidence'].includes(job.operation ?? '') || job.pauseReason === 'source_changed' || ['permission_denied', 'reauthorize'].includes(job.error?.code ?? '')} onClick={onRecheck}>Volver a comprobar fuentes</button>}
      </> : <>
        <p>{job.proposals.length ? `${job.proposals.length} propuestas pendientes de contrastar y unificar. Todavía no se pueden confirmar en la ficha.` : job.status === 'paused' ? 'Aún no hay propuestas guardadas. Podrás revisarlas cuando continúe el análisis.' : 'El análisis no ha encontrado nuevos datos para contrastar. Puedes aportar otra carpeta o continuar con las preguntas de Uony.'}</p>
        <MaterialProposalList key={job.id} job={job} />
        {!!job.proposals.length && onReconcile && <><InformationDisclosure label="Cómo se comprueban los datos"><p>Uony comprobará las fuentes de los datos ya leídos y conservará los valores contradictorios. Esta revisión no modifica la ficha ni repite las llamadas de análisis a la IA.</p></InformationDisclosure>
          <button type="button" className="drive-analysis-review" disabled={reconcileDisabled ?? disabled} onClick={onReconcile}><Icon name="uony" size={17} />Verificar y unificar datos con Uony</button></>}
      </>}
      {facts && <button type="button" className="drive-analysis-review" disabled={reviewBlocked} onClick={onReview}><Icon name="uony" size={17} />Completar requisitos de Amazon con Uony</button>}
    </>}
  </div>;
}
