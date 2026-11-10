import { ClientProduct } from '../common/ClientProduct';
import { UonyPreview } from '../common/UonyPreview';
import { Link } from 'react-router';
import { PATHS } from '../../model/views';

/** 01 · REUNIR: la ficha ilustrativa del juego de piezas. */
export function NewsProductStory() {
  return (
    <article className="news-product-story" aria-labelledby="organize-title">
      <ClientProduct compact />
      <div className="news-story-copy">
        <span className="news-overline">01 · REUNIR</span>
        <h3 id="organize-title">Cada pieza.{' '}<br />En su lugar.</h3>
        <p>El material, las variantes, las fotografías, las medidas. Cuando cada dato tiene un sitio, es más fácil encontrarlo, revisarlo y seguir trabajando.</p>
        <p>Productos reúne esa información alrededor de una misma ficha. Para este juego. Para una colección completa. Para lo que tú quieras crear.</p>
        <Link className="news-text-link" to="/productos#producto-en-accion">Explora Productos <span aria-hidden="true">↗</span></Link>
      </div>
    </article>
  );
}

/** 02 · CONTAR y 03 · AVANZAR. */
export function NewsTwoStories() {
  return (
    <div className="news-two-stories">
      <article className="news-small-story" aria-labelledby="tell-title">
        <figure className="campaign-picture news-campaign">
          <img src="/assets/jenga/erp-campana.webp" data-jenga-asset="campaign" width="1920" height="1280" alt="ERP convertido en protagonista de una campaña, con piezas de madera azul y aqua e iluminación de estudio" loading="lazy" />
          <figcaption><span>UNA MISMA IDEA. OTRA LUZ.</span><strong>Pequeñas piezas.{' '}<br />Grandes ideas.</strong></figcaption>
        </figure>
        <div className="news-small-copy">
          <span className="news-overline">02 · CONTAR</span>
          <h3 id="tell-title">Lo que lo hace especial,{' '}<br />en imágenes y palabras.</h3>
          <p>Del modelo a la imagen de campaña. Del detalle a una historia completa. Explora cómo la IA puede ayudarte a presentar un mismo producto de distintas formas.</p>
          <Link className="news-text-link" to="/productos#contenido-visual">Explora las imágenes, el 3D y el contenido A+ <span aria-hidden="true">↗</span></Link>
        </div>
      </article>
      <article className="news-small-story" aria-labelledby="help-title">
        <UonyPreview preview />
        <div className="news-small-copy">
          <span className="news-overline">03 · AVANZAR</span>
          <h3 id="help-title">Una buena pregunta{' '}<br />abre el siguiente paso.</h3>
          <p>Trabaja con la IA desde el contexto de tus productos. Pide ayuda para revisar, preparar contenido y ordenar las tareas, manteniendo tu criterio en cada decisión.</p>
        </div>
      </article>
    </div>
  );
}

const ROADMAP: ReadonlyArray<{ title: readonly [string, string]; copy: string; tools: ReadonlyArray<{ anchor: string; icon: string; name: string; detail: string }> }> = [
  {
    title: ['Que tu trabajo', 'esté conectado.'],
    copy: 'Del proveedor al pedido, y del pedido a la entrega. El contexto del producto acompaña cada paso.',
    tools: [
      { anchor: 'erp', icon: 'erp', name: 'ERP', detail: 'Pedidos, compras e inventario.' },
      { anchor: 'fabrica', icon: 'fabrica', name: 'Fábrica y proveedores', detail: 'Especificaciones y aprovisionamiento.' },
      { anchor: 'logistica', icon: 'logistica', name: 'Logística', detail: 'Movimientos y entregas.' },
    ],
  },
  {
    title: ['Más contexto.', 'Mejores preguntas.'],
    copy: 'Revisar lo que sabes, entender lo que cambia y encontrar ayuda especializada para avanzar.',
    tools: [
      { anchor: 'auditoria', icon: 'auditoria', name: 'Captura y auditoría', detail: 'Datos de origen y revisión.' },
      { anchor: 'analitica', icon: 'analitica', name: 'Analítica', detail: 'Indicadores y perspectiva.' },
      { anchor: 'agentes', icon: 'hive', name: 'Agentes', detail: 'Especialistas de IA que colaboran.' },
    ],
  },
  {
    title: ['Aprender.', 'Conectar. Seguir.'],
    copy: 'Herramientas que se entienden entre sí y conocimiento que puedes llevar a tu día a día.',
    tools: [
      { anchor: 'academy', icon: 'academy', name: 'Academy', detail: 'Aprendizaje práctico, a tu ritmo.' },
      { anchor: 'nexus', icon: 'nexus', name: 'Nexus', detail: 'Conexiones entre herramientas.' },
    ],
  },
];

/** SERVICIOS DE UONIFY: el universo de herramientas alrededor del catálogo. */
export function NewsBuilding() {
  return (
    <section className="news-building" id="construyendo" aria-labelledby="building-title">
      <div className="wrap">
        <div className="news-building-heading">
          <div><p className="eyebrow">SERVICIOS DE UONIFY</p><h2 id="building-title">La siguiente pieza{' '}<br /><span>también cuenta.</span></h2></div>
          <p>El catálogo es el comienzo. Uonify reúne herramientas que dan continuidad a todo lo que ocurre alrededor de tus productos, conectadas en un mismo espacio.</p>
        </div>
        <div className="news-roadmap">
          {ROADMAP.map(group => (
            <article key={group.title[0]} className="news-roadmap-group">
              <span className="news-development">Servicio Uonify</span>
              <h3>{group.title[0]}<br />{group.title[1]}</h3>
              <p>{group.copy}</p>
              <ul>
                {group.tools.map(tool => (
                  <li key={tool.anchor}>
                    <Link to={`${PATHS.productos}#${tool.anchor}`}>
                      <img src={`/assets/product-icons/${tool.icon}.png`} width="60" height="60" alt="" loading="lazy" />
                      <span><strong>{tool.name}</strong><small>{tool.detail}</small></span>
                      <b aria-hidden="true">↗</b>
                    </Link>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Todas las novedades (desplegables). */
export function NewsAll() {
  return (
    <section className="news-all wrap" id="todas" aria-labelledby="all-title">
      <div className="news-all-heading"><h2 id="all-title">Todas las novedades.</h2><p>Una mirada a cada paso.</p></div>
      <div className="news-articles">
        <details id="novedad-productos" open>
          <summary><span className="news-article-category">PRODUCTOS</span><span className="news-article-title">La primera pieza de Uonify es tu producto.</span><span className="news-expand" aria-hidden="true">+</span></summary>
          <div className="news-article-body">
            <p>Un espacio para reunir los datos de cada producto, dar forma a su contenido y preparar cómo lo presentas. El juego de piezas nos sirve de ejemplo: lo que importa no es solo cada elemento, sino lo que puedes hacer al reunirlos.</p>
            <a className="news-text-link" href="#productos">Ver el recorrido ilustrado <span aria-hidden="true">↑</span></a>
          </div>
        </details>
        <details id="novedad-ia">
          <summary><span className="news-article-category">INTELIGENCIA ARTIFICIAL</span><span className="news-article-title">Tus productos. Tus preguntas. Una conversación.</span><span className="news-expand" aria-hidden="true">+</span></summary>
          <div className="news-article-body">
            <p>Revisar una ficha, preparar una descripción o aclarar qué falta antes de continuar. Esta es la experiencia que queremos acercar: toda la potencia de Uonify, con la ayuda de la IA y el contexto de tu trabajo.</p>
            <p>Los ejemplos de la propuesta son ilustrativos. No realizan una conexión real con la inteligencia artificial.</p>
            <Link className="news-text-link" to="/productos#inteligencia">Conoce esta forma de trabajar <span aria-hidden="true">↗</span></Link>
          </div>
        </details>
        <details id="novedad-familia">
          <summary><span className="news-article-category">SERVICIOS</span><span className="news-article-title">Un universo de herramientas que empieza a tomar forma.</span><span className="news-expand" aria-hidden="true">+</span></summary>
          <div className="news-article-body">
            <p>Operación, información, inteligencia artificial, aprendizaje y conexiones. Los servicios de Uonify comparten el mismo propósito: que las herramientas acompañen tu trabajo y se entiendan entre sí.</p>
            <p>Se activan desde tu espacio Uonify y Uony los coordina en la conversación. Aquí compartiremos sus novedades.</p>
            <a className="news-text-link" href="#construyendo">Explora los servicios de Uonify <span aria-hidden="true">↑</span></a>
          </div>
        </details>
      </div>
    </section>
  );
}
