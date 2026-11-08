import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Expand } from 'lucide-react';
import { Dialog } from '@/shared/ui';
import { PIM_TAB_LABELS } from '@/shared/pim';
import { useRovingTabs } from '../../hooks/useRovingTabs';

const VIEWS = ['atributos', 'descripciones', 'imagenes'] as const;

/** Capturas del módulo real, sin sustituir su interfaz por un editor inventado. */
export function ClientProduct({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const { selected, tabProps } = useRovingTabs(VIEWS, 'atributos');
  const source = (view: typeof selected) => `/assets/interface/producto-${view}.png`;
  const description = (view: typeof selected) => `Módulo Producto de Uonify: ${PIM_TAB_LABELS[view]} del juego Make It Possible, con catálogo, ocho pestañas, publicación y conversación con Uony`;
  return <div className={`product-capture${compact ? ' product-capture-compact' : ''}`}>
    <div className="product-capture-toolbar">
      <div role="tablist" aria-label="Vistas del módulo Producto">
        {VIEWS.map(view => <button key={view} type="button" id={`${id}-${view}`} aria-controls={`${id}-panel-${view}`} {...tabProps(view)}>Ver {PIM_TAB_LABELS[view].toLowerCase()}</button>)}
      </div>
      <button type="button" className="product-capture-expand" onClick={() => setExpanded(true)}><Expand size={15} aria-hidden="true" />Ampliar interfaz</button>
    </div>
    {VIEWS.map(view => <div key={view} role="tabpanel" id={`${id}-panel-${view}`} aria-labelledby={`${id}-${view}`} hidden={view !== selected} tabIndex={0}>
      <button type="button" className="product-capture-image" onClick={() => setExpanded(true)} aria-label={`Ampliar captura de ${PIM_TAB_LABELS[view]}`}>
        <img src={source(view)} alt={description(view)} width="1760" height="767" loading="lazy" />
      </button>
    </div>)}
    {expanded && createPortal(<Dialog open onClose={() => setExpanded(false)} title={`Producto · ${PIM_TAB_LABELS[selected]}`} size="xl" className="product-capture-dialog">
      <img className="product-capture-full" src={source(selected)} alt={description(selected)} width="1760" height="767" />
      <a className="product-capture-original" href={source(selected)} target="_blank" rel="noreferrer">Abrir imagen a tamaño completo ↗</a>
    </Dialog>, document.body)}
  </div>;
}
