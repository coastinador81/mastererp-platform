import { UonyPreview } from '../common/UonyPreview';
import type { InterfaceView } from '../common/InterfaceCapture';
import { useRovingTabs } from '../../hooks/useRovingTabs';
import { HOW_STEPS, HOW_TABS, type HowStepKey } from './howContent';

const VIEWS: Record<HowStepKey, InterfaceView> = { ask: 'espacio-inicio', connect: 'uony-conectar', coordinate: 'uony-archivos', review: 'uony-revision', publish: 'producto-imagenes' };
const KEYS: readonly HowStepKey[] = HOW_TABS.map(tab => tab.key);

/** «Un recorrido, cinco momentos»: pestañas que actualizan el panel en vivo. */
export function JourneyDemo() {
  const { selected, tabProps } = useRovingTabs(KEYS, 'ask');
  const step = HOW_STEPS[selected];
  return (
    <section className="journey-section wrap" id="recorrido" aria-labelledby="journey-title">
      <div className="journey-heading">
        <p className="eyebrow">UN RECORRIDO, CINCO MOMENTOS</p>
        <h2 id="journey-title">Tú ves el resultado.{' '}<br /><span>También puedes ver cómo llegó hasta allí.</span></h2>
        <p>Cada paso conserva su contexto: qué pediste, qué herramientas participaron, qué cambió y qué decisión necesita de ti.</p>
      </div>
      <div className="journey-demo">
        <div className="journey-tabs" role="tablist" aria-label="Explora las cinco etapas">
          {HOW_TABS.map(tab => (
            <button key={tab.key} type="button" aria-controls="journey-panel" data-how-step={tab.key} {...tabProps(tab.key)}>
              <span>{tab.number}</span><strong>{tab.title}</strong><small>{tab.copy}</small>
            </button>
          ))}
        </div>
        <div className="journey-panel" id="journey-panel" role="tabpanel" aria-live="polite" data-journey-panel data-active-step={selected}>
          <div className="journey-panel-top"><span data-live-overline>{step.overline}</span><strong data-live-state>{step.state}</strong></div>
          <div className="journey-panel-visual" data-live-visual={selected}>
            <UonyPreview view={VIEWS[selected]} />
          </div>
          <div className="journey-panel-copy">
            <span data-live-number>{step.number}</span>
            <div><h3 data-live-title>{step.title}</h3><p data-live-description>{step.description}</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}
