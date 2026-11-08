import clsx from 'clsx';
import { Icon } from '@/shared/ui';
import { BULLET_ROWS } from '../model/text';
import { AutoTextarea } from './AutoTextarea';
import { WandButton } from './WandButton';
import type { useDescripciones } from '../hooks/useDescripciones';

type Data = ReturnType<typeof useDescripciones>;

/**
 * «Viñetas de Características (Bullet Points)»: seis filas numeradas (número ·
 * texto · varita y «Vaciar»). «Añadir Viñeta» lleva a la siguiente vacía y se
 * oculta cuando las seis tienen texto.
 */
export function BulletList({ titleId, data, aiField }: { titleId: string; data: Data; aiField: string | null }) {
  return (
    <section className="pim-section pim-descripciones-bullets" aria-labelledby={titleId}>
      <div className="pim-section-head">
        <h3 className="pim-section-title" id={titleId}>Viñetas de Características (Bullet Points)</h3>
      </div>
      <div className="pim-descripciones-bullets-body">
        <ol className="pim-descripciones-bullet-list">
          {data.rows.map((value, i) => (
            <li key={i} className="pim-descripciones-bullet">
              <span className="pim-descripciones-bullet-num" aria-hidden="true">{i + 1}</span>
              <AutoTextarea
                className={clsx('pim-textarea pim-descripciones-input pim-descripciones-bullet-input', aiField === `feature-${i}` && 'is-ai')}
                data-bullet={i}
                rows={2}
                placeholder={`Viñeta ${i + 1}`}
                aria-label={`Viñeta ${i + 1}`}
                value={value}
                onChange={event => data.setBullet(i, event.target.value)}
              />
              <div className="pim-toolbar pim-descripciones-bullet-actions">
                <WandButton
                  field={`feature-${i}`}
                  label={`Generar viñeta ${i + 1} con Uony`}
                  row
                  busy={data.isGenerating(`feature-${i}`)}
                  onGenerate={() => data.generate(`feature-${i}`)}
                />
                <button
                  type="button"
                  className="pim-btn pim-btn-ghost pim-btn-icon pim-descripciones-clear"
                  data-remove={i}
                  aria-label={`Vaciar viñeta ${i + 1}`}
                  data-tooltip={`Vaciar viñeta ${i + 1}`}
                  data-tooltip-align="end"
                  onClick={event => {
                    event.preventDefault();
                    data.clearBullet(i);
                  }}
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="pim-btn pim-btn-ghost pim-btn-sm pim-descripciones-add"
          data-action="add-bullet"
          hidden={data.filled >= BULLET_ROWS}
          onClick={data.addBullet}
        >
          <Icon name="plus" size={16} />
          <span>Añadir Viñeta</span>
        </button>
      </div>
    </section>
  );
}
