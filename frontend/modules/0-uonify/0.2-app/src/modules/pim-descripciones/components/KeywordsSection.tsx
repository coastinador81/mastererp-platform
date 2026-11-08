import clsx from 'clsx';
import { AutoTextarea } from './AutoTextarea';
import { WandButton } from './WandButton';
import type { useDescripciones } from '../hooks/useDescripciones';

type Data = ReturnType<typeof useDescripciones>;

/** «Keywords SEO (Amazon)» con su varita de Uony. */
export function KeywordsSection({ ids, data, aiField }: { ids: { input: string; hint: string }; data: Data; aiField: string | null }) {
  return (
    <section className="pim-section">
      <div className="pim-section-head">
        <h3 className="pim-section-title">
          <label htmlFor={ids.input}>Keywords SEO (Amazon)</label>
        </h3>
        <div className="pim-section-actions">
          <WandButton field="keywords" label="Generar keywords con Uony" busy={data.isGenerating('keywords')} onGenerate={() => data.generate('keywords')} />
        </div>
      </div>
      <div className="pim-field">
        <AutoTextarea
          className={clsx('pim-textarea pim-descripciones-input pim-descripciones-keywords', aiField === 'keywords' && 'is-ai')}
          id={ids.input}
          placeholder="Keywords para SEO..."
          aria-describedby={ids.hint}
          value={data.keywords}
          onChange={event => data.setKeywords(event.target.value)}
        />
        <p className="pim-hint pim-descripciones-hint" id={ids.hint}>Keywords para búsqueda en Amazon</p>
      </div>
    </section>
  );
}
