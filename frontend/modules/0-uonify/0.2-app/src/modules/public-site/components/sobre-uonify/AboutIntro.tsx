import { InterfaceCapture } from '../common/InterfaceCapture';
/** Apertura y «Por qué creamos Uonify» de Sobre Uonify (#view-empresa). */
export function AboutOpening() {
  return (
    <section className="about-opening" aria-labelledby="about-title">
      <div className="about-headline wrap">
        <p className="eyebrow">SOBRE UONIFY</p>
        <h1 id="about-title">Detrás de cada producto <br />hay alguien que quiere <br /><span>hacerlo crecer.</span></h1>
        <p>Una idea. Muchas horas de trabajo. <br />Y las ganas de ver hasta dónde puede llegar.</p>
        <a className="about-scroll" href="#por-que">Por eso existe Uonify <span aria-hidden="true">↓</span></a>
      </div>
      <figure className="about-hero-figure wrap">
        <img src="/assets/sobre-uonify/trabajo-cotidiano.png" width="1672" height="941" alt="Una artesana revisa una taza azul y blanca mientras un compañero prepara un envío en el taller" fetchPriority="high" />
        <figcaption>Un taller de cerámica nos ayuda a contar esta idea. Las escenas son ilustrativas, creadas con IA; no representan a un cliente real.</figcaption>
      </figure>
    </section>
  );
}

const FLOW: ReadonlyArray<{ icon: string; label: string }> = [
  { icon: 'catalogo', label: 'Productos' },
  { icon: 'erp', label: 'Pedidos' },
  { icon: 'logistica', label: 'Envíos' },
];

export function AboutPurpose() {
  return (
    <section className="about-purpose wrap" id="por-que" aria-labelledby="purpose-title">
      <div className="purpose-editorial">
        <div className="purpose-heading">
          <p className="eyebrow">POR QUÉ CREAMOS UONIFY</p>
          <h2 id="purpose-title">Más posibilidades <br />para lo que <span>quieres construir.</span></h2>
        </div>
        <div className="purpose-explanation">
          <p>Vender por internet reúne muchos oficios: presentar un producto, organizar pedidos, coordinar proveedores y entender lo que ocurre. No siempre hace falta más esfuerzo; a veces hace falta que las herramientas trabajen juntas.</p>
          <p>Por eso creamos Uonify. Acercamos esas herramientas y la inteligencia artificial a quienes están empezando y a quienes quieren seguir creciendo. Para que la información acompañe a cada producto, las tareas tengan continuidad y puedas dedicar más atención a lo que estás construyendo. Queremos que llevar una buena idea más lejos no dependa de contar con grandes recursos.</p>
        </div>
      </div>
      <div className="purpose-examples" aria-label="Producto, herramientas y Uony">
        <figure className="purpose-example">
          <div className="purpose-example-visual">
            <InterfaceCapture view="producto-atributos" /></div>
          <figcaption>La información, en su lugar.</figcaption>
        </figure>
        <figure className="purpose-example">
          <div className="purpose-example-visual">
            <ol className="purpose-flow" aria-label="De los productos a los pedidos y los envíos">
              {FLOW.map(step => <li key={step.label}><img src={`/assets/product-icons/${step.icon}.png`} width="66" height="66" alt="" loading="lazy" /><span>{step.label}</span></li>)}
            </ol>
          </div>
          <figcaption>El trabajo, conectado.</figcaption>
        </figure>
        <figure className="purpose-example">
          <div className="purpose-example-visual">
            <InterfaceCapture view="uony-conectar" />
          </div>
          <figcaption>Ayuda para el siguiente paso.</figcaption>
        </figure>
      </div>
    </section>
  );
}
