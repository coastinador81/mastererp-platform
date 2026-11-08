import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { ACTION_MAX, CAMERAS, TEXT_MAX } from '../../model/constants';
import { charCount, clock } from '../../model/format';
import { lintShot } from '../../model/lint';
import type { DestinationSpec } from '../../model/constants';
import type { Shot } from '../../model/types';
import { IssuesList } from './IssuesList';

/**
 * Un plano del guion (prototipo: shotHTML): foto de partida de la ficha, qué pasa,
 * cámara y texto en pantalla, con su estado si hay un vídeo en curso.
 */
interface ShotItemProps {
  shot: Shot;
  index: number;
  spec: DestinationSpec;
  baseId: string;
  textHintId: string;
  state: ReactNode;
  onPick: () => void;
  onChange: (patch: Partial<Shot>) => void;
}

export function ShotItem({ shot, index, spec, baseId, textHintId, state, onPick, onChange }: ShotItemProps) {
  const n = index + 1;
  const start = index * spec.shotSeconds;
  const url = shot.image?.url || '';
  const textLength = charCount(shot.text);
  return (
    <li className="pim-video-shot">
      <div className="pim-video-shot-media">
        <button
          type="button"
          className="pim-video-shot-frame"
          data-action="pick-image"
          data-shot={shot.id}
          aria-label={url ? `Cambiar la foto del plano ${n}` : `Elegir la foto del plano ${n}`}
          onClick={onPick}
        >
          {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <span className="pim-video-shot-empty"><Icon name="image" size={20} /><span>Elige una foto</span></span>}
          <span className="pim-video-shot-change" aria-hidden="true"><Icon name="image" size={14} />{url ? 'Cambiar foto' : 'Elegir foto'}</span>
        </button>
        <div className="pim-video-shot-label"><strong>Plano {n}</strong><span className="pim-mono">{clock(start)} – {clock(start + spec.shotSeconds)}</span></div>
        <div className="pim-video-shot-state">{state}</div>
      </div>
      <div className="pim-video-shot-fields">
        <div className="pim-field">
          <label className="pim-label" htmlFor={`${baseId}-action`}>Qué pasa en el plano</label>
          <textarea
            id={`${baseId}-action`}
            className="pim-textarea"
            rows={3}
            maxLength={ACTION_MAX}
            data-shot={shot.id}
            data-shot-field="action"
            placeholder="La escena, la luz y el ambiente"
            value={shot.action || ''}
            onChange={event => onChange({ action: event.currentTarget.value })}
          />
        </div>
        <div className="pim-video-shot-row">
          <div className="pim-field">
            <label className="pim-label" htmlFor={`${baseId}-camera`}>Cámara</label>
            <select id={`${baseId}-camera`} className="pim-select" data-shot={shot.id} data-shot-field="camera" value={shot.camera} onChange={event => onChange({ camera: event.currentTarget.value })}>
              {CAMERAS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </div>
          <div className="pim-field">
            <div className="pim-label">
              <label htmlFor={`${baseId}-text`}>Texto en pantalla</label>
              <span className={clsx('pim-counter', textLength > TEXT_MAX && 'is-over')} aria-hidden="true">{textLength}/{TEXT_MAX}</span>
            </div>
            <input
              id={`${baseId}-text`}
              className="pim-input"
              type="text"
              maxLength={TEXT_MAX}
              data-shot={shot.id}
              data-shot-field="text"
              value={shot.text || ''}
              placeholder="Opcional"
              autoComplete="off"
              aria-describedby={textHintId}
              onChange={event => onChange({ text: event.currentTarget.value })}
            />
          </div>
        </div>
        <IssuesList issues={lintShot(shot)} />
      </div>
    </li>
  );
}
