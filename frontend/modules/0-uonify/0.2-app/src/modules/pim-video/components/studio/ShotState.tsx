import { Icon } from '@/shared/ui';
import { SHOT_LABELS } from '../../model/constants';
import type { Project, ProjectShot } from '../../model/types';

/**
 * Estado de un plano del vídeo en curso y «Rehacer plano» (prototipo: shotStateHTML).
 * Se puede rehacer un plano bloqueado o fallido, o uno listo cuando el vídeo terminó.
 */
interface ShotStateProps {
  project: Project;
  status: ProjectShot;
  locked: boolean;
  retrying: boolean;
  sending: boolean;
  onRetry: () => void;
}

export function ShotState({ project, status, locked, retrying, sending, onRetry }: ShotStateProps) {
  const info = SHOT_LABELS[status.status] || SHOT_LABELS.queued;
  const canRetry = !locked && (['blocked', 'failed'].includes(status.status) || (status.status === 'done' && project.status === 'done'));
  const blocked = !retrying && sending;
  return (
    <>
      <span className={`pim-badge ${info.tone}`}>
        {status.status === 'generating' ? <Icon name="loader" size={12} className="pim-spin" /> : null}
        {info.label}
      </span>
      {status.error ? <small className="pim-video-shot-error">{status.error}</small> : null}
      {canRetry ? (
        <button
          type="button"
          className="pim-btn pim-btn-outline pim-btn-sm"
          aria-disabled={retrying || blocked || undefined}
          aria-busy={retrying || undefined}
          onClick={() => {
            if (!retrying && !blocked) onRetry();
          }}
        >
          <Icon name="refresh-cw" size={14} className={retrying ? 'pim-spin' : undefined} />Rehacer plano
        </button>
      ) : null}
    </>
  );
}
