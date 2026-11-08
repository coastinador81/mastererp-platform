import { UonyPreview } from '../common/UonyPreview';
/** Etapas 01 a 03 de «Cómo funciona»: pedir, conectar y coordinar. */
export function AskStory() {
  return (
    <section className="how-story ask-story" id="pedir" aria-labelledby="ask-title">
      <div className="wrap story-layout">
        <div className="story-copy">
          <p className="eyebrow">01 · PEDIR</p>
          <h2 id="ask-title">No empiezas buscando botones.{' '}<br /><span>Empiezas contando qué necesitas.</span></h2>
          <p>Habla con Uony o escribe una petición, selecciona un producto o trabaja con un catálogo completo. La conversación mantiene cerca los datos y las decisiones que importan.</p>
        </div>
        <UonyPreview view="uony-conectar" />
      </div>
    </section>
  );
}

const CONNECTION_NODES: ReadonlyArray<{ className: string; kind: string; title: string; copy: string }> = [
  { className: 'node-one', kind: 'FUENTE', title: 'Catálogo', copy: 'productos y atributos' },
  { className: 'node-two', kind: 'CUENTA', title: 'Google', copy: 'tu proyecto y tus modelos' },
  { className: 'node-three', kind: 'DESTINO', title: 'Marketplace', copy: 'requisitos del canal' },
  { className: 'node-four', kind: 'SISTEMA', title: 'ERP', copy: 'operación e inventario' },
];

export function ConnectStory() {
  return (
    <section className="how-story connect-story wrap" id="conectar" aria-labelledby="connect-title">
      <div className="connection-canvas" aria-label="Fuentes y servicios conectados a un contexto común">
        <svg viewBox="0 0 800 520" aria-hidden="true"><path d="M150 110 C280 110 270 250 400 260" /><path d="M150 410 C280 410 270 280 400 260" /><path d="M650 110 C520 110 530 250 400 260" /><path d="M650 410 C520 410 530 280 400 260" /></svg>
        {CONNECTION_NODES.map(node => (
          <article key={node.className} className={`connection-node ${node.className}`}><span>{node.kind}</span><strong>{node.title}</strong><small>{node.copy}</small></article>
        ))}
        <div className="connection-core"><img src="/assets/product-icons/nexus.png" width="110" height="110" alt="Nexus de Uonify" /><strong>Tu contexto</strong><span>con permisos definidos</span></div>
      </div>
      <div className="story-copy">
        <p className="eyebrow">02 · CONECTAR</p>
        <h2 id="connect-title">Tus herramientas aportan contexto.{' '}<br /><span>Tú decides cuál.</span></h2>
        <p>Conecta cuentas, fuentes y destinos. Uonify reúne solo el alcance necesario para que una tarea pueda avanzar sin perder su origen.</p>
        <dl>
          <div><dt>Sesión</dt><dd>Cada persona trabaja con su identidad y permisos.</dd></div>
          <div><dt>Alcance</dt><dd>Las conexiones muestran qué pueden leer o modificar.</dd></div>
          <div><dt>Contexto</dt><dd>Los datos conservan su fuente durante todo el recorrido.</dd></div>
        </dl>
      </div>
    </section>
  );
}

export function CoordinateStory() {
  return (
    <section className="how-story coordinate-story" id="coordinar" aria-labelledby="coordinate-title">
      <div className="wrap">
        <div className="coordinate-heading">
          <div className="story-copy">
            <p className="eyebrow">03 · COORDINAR</p>
            <h2 id="coordinate-title">Una petición puede necesitar{' '}<br /><span>más de una herramienta.</span></h2>
          </div>
          <p>Uonify divide el trabajo, comparte el contexto entre especialistas y vuelve a reunir los resultados en una sola vista.</p>
        </div>
        <UonyPreview view="uony-archivos" />
      </div>
    </section>
  );
}
