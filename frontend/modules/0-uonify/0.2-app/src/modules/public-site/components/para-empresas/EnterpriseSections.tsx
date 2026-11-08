import { InterfaceCapture } from '../common/InterfaceCapture';
import { UonyPreview } from '../common/UonyPreview';

const CHANNEL_OUTPUTS: ReadonlyArray<{ className: string; kind: string; title: string; copy: string }> = [
  { className: 'output-one', kind: 'MARKETPLACE', title: 'Título optimizado', copy: '8 atributos obligatorios' },
  { className: 'output-two', kind: 'TIENDA ONLINE', title: 'Contenido de marca', copy: 'Galería y descripción' },
  { className: 'output-three', kind: 'B2B', title: 'Ficha comercial', copy: 'Tarifa y disponibilidad' },
  { className: 'output-four', kind: 'EQUIPO', title: 'Vista operativa', copy: 'Costes y responsables' },
];

/** UNA FUENTE. CADA CANAL. */
export function ChannelsSection() {
  return (
    <section className="channels-section" id="canales" aria-labelledby="channels-title">
      <div className="wrap channels-layout">
        <div className="channels-copy">
          <p className="eyebrow">UNA FUENTE. CADA CANAL.</p>
          <h2 id="channels-title">La información cambia de forma.{' '}<br /><span>El producto sigue siendo el mismo.</span></h2>
          <p>Centraliza la información esencial y prepara cada versión según el canal: títulos, atributos, imágenes, contenido enriquecido y requisitos específicos.</p>
          <ul><li>Una base compartida para todos los equipos.</li><li>Versiones adaptadas sin perder el origen.</li><li>Cambios que se pueden revisar y seguir.</li></ul>
        </div>
        <div className="channel-visual" aria-label="Un producto central se adapta para cuatro canales">
          <div className="channel-source"><img src="/assets/product-icons/catalogo.png" width="92" height="92" alt="" /><span>PRODUCTO MAESTRO</span><strong>Una historia.{' '}<br />Todos sus datos.</strong></div>
          {CHANNEL_OUTPUTS.map(output => (
            <div key={output.className} className={`channel-output ${output.className}`}><small>{output.kind}</small><strong>{output.title}</strong><span>{output.copy}</span></div>
          ))}
          <svg viewBox="0 0 720 520" aria-hidden="true"><path d="M350 255C250 250 230 105 150 90M350 255C470 245 490 105 575 90M350 255C245 275 230 420 145 430M350 255C475 270 490 420 580 430" /></svg>
        </div>
      </div>
    </section>
  );
}

/** INTELIGENCIA ARTIFICIAL EN TU OPERACIÓN: una petición del equipo y su recorrido. */
export function EnterpriseAi() {
  return (
    <section className="enterprise-ai wrap enterprise-section" aria-labelledby="ai-enterprise-title">
      <div className="enterprise-section-heading centered">
        <img className="section-character" src="/assets/product-icons/hive.png" width="108" height="108" alt="Agentes de Uonify" loading="lazy" />
        <p className="eyebrow">INTELIGENCIA ARTIFICIAL EN TU OPERACIÓN</p>
        <h2 id="ai-enterprise-title">No empieza con una pantalla.{' '}<br /><span>Empieza con lo que necesitas conseguir.</span></h2>
        <p>Tu equipo plantea el objetivo con sus propias palabras. Uonify aporta el contexto, coordina las herramientas y prepara el trabajo dentro de los límites que hayas definido.</p>
      </div>
      <div className="enterprise-interface-wide"><UonyPreview preview /></div>
    </section>
  );
}

/** VELOCIDAD CON CONTROL: permisos, aprobaciones y trazabilidad. */
export function ControlSection() {
  return (
    <section className="control-section" id="control" aria-labelledby="control-title">
      <div className="wrap control-layout">
        <InterfaceCapture view="producto-descripciones" />
        <div className="control-copy">
          <p className="eyebrow">VELOCIDAD CON CONTROL</p>
          <h2 id="control-title">La IA avanza.{' '}<br /><span>Tu empresa decide.</span></h2>
          <p>Automatizar no significa perder el criterio. Define permisos, responsables y puntos de aprobación para que cada equipo sepa qué puede hacer y qué necesita revisar.</p>
          <dl>
            <div><dt>Permisos</dt><dd>Cada rol accede solo a lo que necesita.</dd></div>
            <div><dt>Aprobaciones</dt><dd>Los cambios sensibles esperan una decisión humana.</dd></div>
            <div><dt>Trazabilidad</dt><dd>Cada paso conserva su origen y su responsable.</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}
