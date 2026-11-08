import { Link } from 'react-router';

interface StoryTool { anchor: string; icon: string; title: string; copy: string }

interface JourneyStory {
  id: string;
  reverse?: boolean;
  image: { src: string; alt: string; className?: string };
  caption: string;
  kicker: string;
  title: readonly [string, string];
  paragraphs: readonly [string, string];
  tools: readonly StoryTool[];
}

/** Las tres escenas del taller: dar a conocer, cuidar el pedido y aprender. */
const STORIES: readonly JourneyStory[] = [
  {
    id: 'story-catalog-title',
    image: { src: 'preparar-catalogo-v44.png', alt: 'La artesana prepara una taza azul y blanca sobre papel claro para presentarla en su catálogo', className: 'catalog-story-image' },
    caption: '01 · Dar a conocer lo que haces.',
    kicker: 'DE LA PIEZA A SU HISTORIA',
    title: ['No es solo una taza. ', 'Es todo lo que la hace especial.'],
    paragraphs: [
      'El esmalte, las medidas, los colores, cómo se cuida. Cada detalle ayuda a que otra persona entienda la pieza antes de tenerla en las manos.',
      'Reunir esa información, contrastarla y convertirla en imágenes y palabras es el comienzo de una buena presentación, tanto en tu tienda como en otros canales.',
    ],
    tools: [
      { anchor: 'catalogo', icon: 'catalogo', title: 'Productos', copy: 'Información, variantes, imágenes y contenido, alrededor de cada pieza.' },
      { anchor: 'auditoria', icon: 'auditoria', title: 'Captura y auditoría', copy: 'Recoger los datos de origen y ver qué falta por comprobar.' },
    ],
  },
  {
    id: 'story-order-title',
    reverse: true,
    image: { src: 'cuidado-del-producto.png', alt: 'Una pieza de cerámica azul se prepara con cuidado para su embalaje en el taller' },
    caption: '02 · Cuidar también lo que pasa después.',
    kicker: 'DEL TALLER A QUIEN TE ELIGE',
    title: ['Un pedido mueve ', 'mucho más que una caja.'],
    paragraphs: [
      'Hay que saber qué queda, qué hace falta pedir, con quién contar y cómo preparar la entrega. Detrás de ese paquete hay muchas pequeñas decisiones que necesitan entenderse entre sí.',
      'El producto es el punto común: conecta a quien lo fabrica, a quien organiza el negocio y a quien lo lleva a su destino.',
    ],
    tools: [
      { anchor: 'fabrica', icon: 'fabrica', title: 'Fábrica y proveedores', copy: 'Especificaciones, materiales y aliados para preparar la producción.' },
      { anchor: 'erp', icon: 'erp', title: 'ERP', copy: 'Relacionar pedidos, compras, clientes e inventario.' },
      { anchor: 'logistica', icon: 'logistica', title: 'Logística', copy: 'Seguir los movimientos y las etapas hasta la entrega.' },
    ],
  },
  {
    id: 'story-learn-title',
    image: { src: 'entender-negocio-v44.png', alt: 'La misma artesana revisa una libreta junto a su portátil y las piezas azules del taller' },
    caption: '03 · Mirar lo que pasa. Encontrar cómo seguir.',
    kicker: 'DE CADA EXPERIENCIA, ALGO QUE APRENDER',
    title: ['Crecer también es ', 'hacerte mejores preguntas.'],
    paragraphs: [
      '¿Qué piezas se piden más? ¿Cómo cambia el trabajo de un canal a otro? ¿Qué conviene preparar para la próxima colección?',
      'Los datos ayudan a mirar con perspectiva. Aprender a interpretarlos y a usar las herramientas convierte esa información en criterio para tu próxima decisión.',
    ],
    tools: [
      { anchor: 'analitica', icon: 'analitica', title: 'Analítica', copy: 'Leer indicadores, comparar y entender la evolución del negocio.' },
      { anchor: 'academy', icon: 'academy', title: 'Academy', copy: 'Aprender con situaciones prácticas y llevarlas a tu trabajo.' },
    ],
  },
];

/** «Un negocio. Muchos momentos conectados.» */
export function AboutJourney() {
  return (
    <section className="about-journey wrap" id="un-mismo-hilo" aria-labelledby="journey-title">
      <div className="journey-heading">
        <p className="eyebrow">UN NEGOCIO. MUCHOS MOMENTOS CONECTADOS.</p>
        <h2 id="journey-title">Lo que empieza en tus manos <br /><span>puede llegar mucho más lejos.</span></h2>
        <p>Imagina este taller. La misma colección pasa de la mesa de trabajo al catálogo, del catálogo a un pedido y de cada pedido a algo que aprender. Uonify conecta las herramientas que acompañan ese recorrido.</p>
      </div>
      {STORIES.map(story => (
        <article key={story.id} className={`journey-story${story.reverse ? ' reverse' : ''}`} aria-labelledby={story.id}>
          <figure className="story-figure">
            <img className={story.image.className} src={`/assets/sobre-uonify/${story.image.src}`} width="1448" height="1086" alt={story.image.alt} loading="lazy" />
            <figcaption>{story.caption}</figcaption>
          </figure>
          <div className="story-copy">
            <span className="story-kicker">{story.kicker}</span>
            <h3 id={story.id}>{story.title[0]}<br />{story.title[1]}</h3>
            <p>{story.paragraphs[0]}</p>
            <p>{story.paragraphs[1]}</p>
            <ul className="story-tools">
              {story.tools.map(tool => (
                <li key={tool.anchor}>
                  <Link to={`/productos#${tool.anchor}`}>
                    <img src={`/assets/product-icons/${tool.icon}.png`} width="64" height="64" alt="" loading="lazy" />
                    <span><strong>{tool.title}</strong><span>{tool.copy}</span></span>
                    <b aria-hidden="true">↗</b>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </article>
      ))}
      <div className="journey-takeaway">
        <p>La fuerza no está solo en lo que hace cada herramienta. <br /><strong>Está en todo lo que puedes hacer cuando trabajan juntas.</strong></p>
      </div>
    </section>
  );
}
