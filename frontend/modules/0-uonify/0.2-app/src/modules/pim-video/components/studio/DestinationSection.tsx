import { useRef, type KeyboardEvent } from 'react';
import { Icon } from '@/shared/ui';
import { DESTINATIONS, DESTINATION_IDS } from '../../model/constants';
import type { Destination } from '../../model/types';

/**
 * Destino del vídeo: ficha de Amazon o anuncio (prototipo: destinationHTML). Grupo
 * de opción única con un solo punto de tabulación; las flechas, Inicio y Fin eligen.
 */
interface DestinationSectionProps {
  headingId: string;
  value: Destination;
  onChange: (value: Destination) => void;
}

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function DestinationSection({ headingId, value, onChange }: DestinationSectionProps) {
  const refs = useRef(new Map<Destination, HTMLButtonElement>());
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP[event.key];
    if (!step && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const index = DESTINATION_IDS.indexOf(value);
    const last = DESTINATION_IDS.length - 1;
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? last : (Math.max(0, index) + step + DESTINATION_IDS.length) % DESTINATION_IDS.length;
    const next = DESTINATION_IDS[nextIndex];
    if (next === value) return;
    refs.current.get(next)?.focus({ preventScroll: true });
    onChange(next);
  };
  return (
    <section className="pim-section" aria-labelledby={headingId}>
      <div className="pim-section-head"><h3 className="pim-section-title" id={headingId}>Destino</h3></div>
      <div className="pim-video-dest" role="radiogroup" aria-labelledby={headingId} onKeyDown={onKeyDown}>
        {DESTINATION_IDS.map(id => {
          const spec = DESTINATIONS[id];
          const checked = value === id;
          return (
            <button
              key={id}
              ref={node => {
                if (node) refs.current.set(id, node);
                else refs.current.delete(id);
              }}
              type="button"
              role="radio"
              className="pim-option pim-video-dest-option"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => { if (!checked) onChange(id); }}
            >
              <span className="pim-video-dest-icon" aria-hidden="true"><Icon name={spec.icon} size={18} /></span>
              <span className="pim-video-dest-text"><strong>{spec.label}</strong><small>{spec.detail}</small></span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
