import { useId } from 'react';
import { Icon } from '@/shared/ui';
import { DESTINATIONS } from '../../model/constants';
import { asArray, clock } from '../../model/format';
import { locked as isLocked } from '../../model/project';
import { effectiveFormat } from '../../model/studio';
import type { Plan, ProjectShot, Shot, StudioState } from '../../model/types';
import { ClosingItem } from './ClosingItem';
import { ShotItem } from './ShotItem';
import { ShotState } from './ShotState';

/**
 * Guion por planos y cierre de marca (prototipo: planHTML). Cada plano parte de una
 * foto de la ficha; «Proponer con Uony» sustituye el guion (POST /video/plans).
 */
interface PlanSectionProps {
  state: StudioState;
  plan: Plan;
  brand: string;
  textHintId: string;
  proposing: boolean;
  sending: boolean;
  retryingShot: (shotId: string) => boolean;
  onPropose: () => void;
  onPick: (shotId: string) => void;
  onShot: (shotId: string, patch: Partial<Shot>) => void;
  onTagline: (tagline: string) => void;
  onRetry: (shotId: string) => void;
}

export function PlanSection({ state, plan, brand, textHintId, proposing, sending, retryingShot, onPropose, onPick, onShot, onTagline, onRetry }: PlanSectionProps) {
  const headingId = useId();
  const spec = DESTINATIONS[state.destination];
  const total = spec.shots * spec.shotSeconds + spec.closingSeconds;
  const project = state.project && state.project.destination === state.destination ? state.project : null;
  const statusOf = (shotId: string): ProjectShot | null => asArray<ProjectShot>(project?.shots).find(shot => shot.id === shotId) || null;
  const locked = isLocked(state);

  return (
    <section className="pim-section is-divided" aria-labelledby={headingId}>
      <div className="pim-section-head">
        <div>
          <h3 className="pim-section-title" id={headingId}>
            Guion<span className="pim-badge pim-video-plan-length">{spec.shots} planos · {clock(total)}</span>
            {plan.origin === 'ia' ? <span className="pim-ai-mark"><Icon name="uony" size={12} />Propuesto por Uony</span> : null}
          </h3>
          <p className="pim-section-sub">Cada plano parte de una foto de tu ficha. Uonify añade los textos y el cierre de marca en el montaje.</p>
        </div>
        <div className="pim-section-actions">
          <button
            type="button"
            className="pim-btn pim-btn-ai pim-btn-sm"
            aria-disabled={proposing || undefined}
            aria-busy={proposing || undefined}
            onClick={() => { if (!proposing) onPropose(); }}
          >
            {proposing ? <Icon name="loader" size={14} className="pim-spin" /> : <Icon name="uony" size={14} />}
            {proposing ? 'Proponiendo…' : 'Proponer con Uony'}
          </button>
        </div>
      </div>
      <ol className="pim-video-shots" data-format={effectiveFormat(state)}>
        {plan.shots.map((shot, index) => {
          const status = statusOf(shot.id);
          return (
            <ShotItem
              key={shot.id}
              shot={shot}
              index={index}
              spec={spec}
              baseId={`${headingId}-${shot.id}`}
              textHintId={textHintId}
              state={status && project ? (
                <ShotState project={project} status={status} locked={locked} retrying={retryingShot(shot.id)} sending={sending} onRetry={() => onRetry(shot.id)} />
              ) : null}
              onPick={() => onPick(shot.id)}
              onChange={patch => onShot(shot.id, patch)}
            />
          );
        })}
        <ClosingItem
          tagline={plan.closing?.tagline || ''}
          brand={brand}
          spec={spec}
          baseId={`${headingId}-closing`}
          textHintId={textHintId}
          onChange={onTagline}
        />
      </ol>
    </section>
  );
}
