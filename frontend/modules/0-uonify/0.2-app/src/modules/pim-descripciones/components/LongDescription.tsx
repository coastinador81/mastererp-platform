import clsx from 'clsx';
import { SubTabs } from '@/shared/ui';
import { AutoTextarea } from './AutoTextarea';
import { SafeHtml } from './SafeHtml';
import { WandButton } from './WandButton';
import type { useDescripciones } from '../hooks/useDescripciones';

type Data = ReturnType<typeof useDescripciones>;

/**
 * «Descripción Larga»: Vista | HTML (conmutador de dos estados; el segmento
 * pulsado es el modo actual) y varita de Uony. La vista previa es una superficie
 * suave de solo lectura con HTML saneado; el editor, un textarea monoespaciado.
 */
export function LongDescription({ ids, data, preview, onPreviewChange, aiField }: {
  ids: { label: string; editor: string; hint: string };
  data: Data;
  preview: boolean;
  onPreviewChange: (preview: boolean) => void;
  aiField: string | null;
}) {
  const aiOnDescription = aiField === 'description';
  return (
    <section className="pim-section" aria-labelledby={ids.label}>
      <div className="pim-section-head">
        <h3 className="pim-section-title">
          <label id={ids.label} htmlFor={preview ? undefined : ids.editor}>Descripción Larga</label>
        </h3>
        <div className="pim-section-actions">
          <SubTabs
            mode="toggle"
            className="pim-descripciones-view"
            value={preview ? 'preview' : 'code'}
            onChange={view => onPreviewChange(view === 'preview')}
            options={[
              { value: 'preview', label: <span>Vista</span>, icon: 'eye' },
              { value: 'code', label: <span>HTML</span>, icon: 'code' },
            ]}
          />
          <WandButton field="description" label="Generar descripción con Uony" busy={data.isGenerating('description')} onGenerate={() => data.generate('description')} />
        </div>
      </div>
      <div className="pim-field">
        <div className="pim-descripciones-field" data-slot="long">
          {preview ? (
            <div className={clsx('pim-descripciones-surface pim-descripciones-preview', aiOnDescription && 'is-ai-ring')} aria-describedby={ids.hint}>
              <SafeHtml html={data.previewHtml} />
            </div>
          ) : (
            <AutoTextarea
              id={ids.editor}
              className={clsx('pim-textarea pim-descripciones-input pim-descripciones-surface pim-descripciones-code', aiOnDescription && 'is-ai')}
              placeholder="<p>Describe las características principales del producto...</p>"
              spellCheck={false}
              aria-describedby={ids.hint}
              value={data.codeValue}
              onChange={event => data.setDescription(event.target.value)}
            />
          )}
        </div>
        <p className="pim-hint pim-descripciones-hint" id={ids.hint}>
          {preview ? 'Vista previa del HTML. Click en "HTML" para editar el código.' : 'Editando HTML. Click en "Vista" para ver el resultado.'}
        </p>
      </div>
    </section>
  );
}
