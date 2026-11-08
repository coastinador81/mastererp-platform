import { useId } from 'react';
import { InterfaceCapture, type InterfaceView } from '../common/InterfaceCapture';
import { useRovingTabs } from '../../hooks/useRovingTabs';
import { SCALE_TABS } from './enterpriseContent';

const VIEWS: Record<string, InterfaceView> = { receive: 'producto-atributos', enrich: 'producto-descripciones', review: 'uony-revision', publish: 'producto-imagenes' };
const KEYS = SCALE_TABS.map(tab => tab.key);

/** Etapas editoriales acompañadas por pantallas del producto actual. */
export function ScaleDemo() {
  const id = useId();
  const { selected, tabProps } = useRovingTabs(KEYS, 'receive');
  return <section className="enterprise-scale wrap enterprise-section" id="escala" aria-labelledby="scale-title">
    <div className="enterprise-section-heading">
      <p className="eyebrow">TRABAJAR A ESCALA</p>
      <h2 id="scale-title">Cada producto, conectado. <span>Cada paso, en su lugar.</span></h2>
      <p>Reúne los datos, prepara el contenido y revisa el resultado con Uony desde el mismo espacio de trabajo.</p>
    </div>
    <div className="scale-demo">
      <div className="scale-steps" role="tablist" aria-label="Etapas de trabajo con Producto">
        {SCALE_TABS.map(tab => <button key={tab.key} type="button" id={`${id}-${tab.key}`} aria-controls={`${id}-panel`} {...tabProps(tab.key)}><span>{tab.number}</span><strong>{tab.title}</strong><small>{tab.copy}</small></button>)}
      </div>
      <div className="scale-current-panel" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${selected}`}>
        <InterfaceCapture view={VIEWS[selected]} />
      </div>
    </div>
  </section>;
}
