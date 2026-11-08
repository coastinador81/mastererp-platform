import { useId, useRef } from 'react';
import { useAiActiveField } from '../hooks/aiActivity';
import { useDescripciones } from '../hooks/useDescripciones';
import { useHtmlPreviewMode } from '../hooks/viewMode';
import { BulletList } from './BulletList';
import { KeywordsSection } from './KeywordsSection';
import { LongDescription } from './LongDescription';
import '../styles/descripciones.css';

/**
 * Pestaña «Descripciones» (prototipo: pim/descripciones.js): tres bloques
 * planos (Descripción Larga, Viñetas y Keywords SEO) con las varitas de Uony.
 */
export function DescripcionesTab() {
  const base = `pim-descripciones${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const data = useDescripciones(rootRef);
  const aiField = useAiActiveField();
  const [preview, setPreview] = useHtmlPreviewMode();
  return (
    <div ref={rootRef} className="pim-descripciones">
      <LongDescription
        ids={{ label: `${base}-long-label`, editor: `${base}-long`, hint: `${base}-long-hint` }}
        data={data}
        preview={preview}
        onPreviewChange={setPreview}
        aiField={aiField}
      />
      <BulletList titleId={`${base}-bullets-title`} data={data} aiField={aiField} />
      <KeywordsSection ids={{ input: `${base}-keywords`, hint: `${base}-keywords-hint` }} data={data} aiField={aiField} />
    </div>
  );
}
