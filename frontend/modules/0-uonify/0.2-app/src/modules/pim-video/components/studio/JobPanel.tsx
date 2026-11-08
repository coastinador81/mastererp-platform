import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { DESTINATIONS, PROJECT_LABELS } from '../../model/constants';
import { crossOrigin } from '../../model/format';
import { projectNote, projectProgress } from '../../model/project';
import type { Destination, Project } from '../../model/types';
import { OriginLine } from '../library/OriginLine';

/**
 * Vídeo en curso y resultado (prototipo: jobHTML): progreso por planos, aviso si
 * falla y, al terminar, el vídeo generado con su línea de origen (texto aprobado).
 */
interface JobPanelProps {
  project: Project;
  destination: Destination;
  headingId: string;
  onOpenResult: () => void;
  onDownload: () => void;
  onDismiss: () => void;
  onGoTo: (destination: Destination) => void;
}

export function JobPanel({ project, destination, headingId, onOpenResult, onDownload, onDismiss, onGoTo }: JobPanelProps) {
  if (project.status === 'done' && project.result) {
    const result = project.result;
    return (
      <section className="pim-video-result" aria-labelledby={headingId}>
        <div className={clsx('pim-video-result-media', project.format === '9:16' && 'is-vertical')}>
          <video
            className="pim-video-player"
            controls
            playsInline
            preload="metadata"
            crossOrigin={crossOrigin(result.url) ? 'anonymous' : undefined}
            src={result.url}
            poster={result.poster || undefined}
            aria-label="Vídeo generado"
          />
        </div>
        <div className="pim-video-result-text">
          <h3 className="pim-section-title" id={headingId}><Icon name="check-circle" size={16} />Tu vídeo está listo</h3>
          <OriginLine generation={result.generation} />
          <div className="pim-section-actions">
            <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" onClick={onOpenResult}><Icon name="video" size={14} />Ver en Vídeos del producto</button>
            <button type="button" className="pim-btn pim-btn-ghost pim-btn-sm" onClick={onDownload}><Icon name="download" size={14} />Descargar</button>
          </div>
        </div>
        <button
          type="button"
          className="pim-btn pim-btn-ghost pim-btn-icon pim-video-result-close"
          aria-label="Cerrar el resultado"
          data-tooltip="Cerrar"
          data-tooltip-align="end"
          onClick={onDismiss}
        >
          <Icon name="x" size={16} />
        </button>
      </section>
    );
  }
  if (project.status === 'failed') {
    return (
      <div className="pim-alert pim-alert-red pim-video-job-alert">
        <Icon name="alert-circle" size={16} />
        <div>
          <strong id={headingId}>No se pudo generar el vídeo</strong>
          <p>{project.error || 'El servicio de vídeo no ha podido terminarlo. El saldo de lo que no se generó no se descuenta.'}</p>
        </div>
        <button type="button" className="pim-btn pim-btn-ghost pim-btn-sm" onClick={onDismiss}>Cerrar</button>
      </div>
    );
  }
  const { finished, total, pct } = projectProgress(project);
  const waiting = project.status === 'waiting';
  const elsewhere = waiting && destination !== project.destination;
  return (
    <section className="pim-card pim-card-soft pim-video-job" aria-labelledby={headingId}>
      <div className="pim-video-job-head">
        <h3 className="pim-section-title" id={headingId}>
          {waiting ? <Icon name="alert-triangle" size={16} /> : <Icon name="loader" size={16} className="pim-spin" />}
          {PROJECT_LABELS[project.status]}
        </h3>
        <span className="pim-mono pim-video-job-count">{finished}/{total} planos</span>
      </div>
      <div className="pim-progress pim-progress-ai" role="progressbar" aria-label="Progreso del vídeo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="pim-video-job-foot">
        <p className="pim-video-note">{projectNote(project, destination)}</p>
        {elsewhere ? (
          <button type="button" className="pim-btn pim-btn-outline pim-btn-sm" onClick={() => onGoTo(project.destination)}>Ir a {DESTINATIONS[project.destination].label}</button>
        ) : null}
      </div>
    </section>
  );
}
