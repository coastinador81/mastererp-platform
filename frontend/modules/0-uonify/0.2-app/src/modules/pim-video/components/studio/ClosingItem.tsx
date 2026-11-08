import { TEXT_MAX, type DestinationSpec } from '../../model/constants';
import { charCount, clock } from '../../model/format';
import { lintClosing } from '../../model/lint';
import { IssuesList } from './IssuesList';

/**
 * Cierre de marca (prototipo: closingHTML): superficie de tinta con la marca y el
 * lema, como en el vídeo, y el campo del lema con su revisión.
 */
interface ClosingItemProps {
  tagline: string;
  brand: string;
  spec: DestinationSpec;
  baseId: string;
  textHintId: string;
  onChange: (tagline: string) => void;
}

export function ClosingItem({ tagline, brand, spec, baseId, textHintId, onChange }: ClosingItemProps) {
  const start = spec.shots * spec.shotSeconds;
  return (
    <li className="pim-video-shot is-closing">
      <div className="pim-video-shot-media">
        <div className="pim-video-shot-frame pim-video-closing-card" aria-hidden="true"><strong>{brand || 'Tu marca'}</strong><span>{tagline}</span></div>
        <div className="pim-video-shot-label"><strong>Cierre de marca</strong><span className="pim-mono">{clock(start)} – {clock(start + spec.closingSeconds)}</span></div>
      </div>
      <div className="pim-video-shot-fields">
        <div className="pim-field">
          <div className="pim-label">
            <label htmlFor={`${baseId}-tagline`}>Lema del cierre</label>
            <span className="pim-counter" aria-hidden="true">{charCount(tagline)}/{TEXT_MAX}</span>
          </div>
          <input
            id={`${baseId}-tagline`}
            className="pim-input"
            type="text"
            maxLength={TEXT_MAX}
            data-closing-field="tagline"
            value={tagline}
            placeholder="Opcional"
            autoComplete="off"
            aria-describedby={`${baseId}-hint ${textHintId}`}
            onChange={event => onChange(event.currentTarget.value)}
          />
          <p className="pim-hint" id={`${baseId}-hint`}>Con el nombre de tu marca, al final del vídeo, como recomienda Amazon.</p>
        </div>
        <IssuesList issues={lintClosing({ tagline })} />
      </div>
    </li>
  );
}
