import { Link } from 'react-router';
import productosCss from '../../styles/pages/productos.css?inline';
import sobreUonifyCss from '../../styles/pages/sobre-uonify.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PATHS, PUBLIC_VIEWS } from '../../model/views';
import { HomeLink } from '../common/HomeLink';
import { PageFooter, SITE_FOOTER_LINKS } from '../common/PageFooter';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';
import { AboutOpening, AboutPurpose } from './AboutIntro';
import { AboutJourney } from './AboutJourney';

const SHEETS = viewSheets(productosCss, sobreUonifyCss);
const FOOTER = SITE_FOOTER_LINKS;

function AboutTechnology() {
  return (
    <section className="about-technology" id="tecnologia" aria-labelledby="technology-title">
      <div className="wrap">
        <div className="technology-layout">
          <div className="technology-copy">
            <p className="eyebrow">EL MISMO HILO. UNA NUEVA FORMA DE TRABAJAR.</p>
            <h2 id="technology-title">La potencia de Uonify. <br /><span>En una conversación.</span></h2>
            <p>Pide lo que necesitas con tus palabras. Uony reúne el contexto de tus productos, trabaja con las herramientas adecuadas y te deja revisar cada resultado.</p>
            <p>La inteligencia artificial acerca las herramientas a tu manera de pensar. El contexto de tus productos da sentido a la ayuda. Y tu criterio marca el rumbo.</p>
            <Link className="text-link" to="/productos#inteligencia">Descubre esta forma de trabajar <span aria-hidden="true">↗</span></Link>
          </div>
          <div className="conversation-illustration" aria-label="Ejemplos ilustrativos de peticiones para el taller">
            <span className="conversation-label">TU TALLER, EN TUS PALABRAS</span>
            <p>«Revisa la nueva colección. <br />¿Qué información falta?»</p>
            <p>«Ayúdame a contar qué hace <br />especiales estas piezas».</p>
            <p>«Compara los pedidos de este mes <br />y ayúdame a entender los cambios».</p>
            <span className="conversation-note">Tú planteas el objetivo. Revisas las propuestas. Decides cómo seguir.</span>
          </div>
        </div>
        <div className="connected-tools">
          <Link to="/productos#agentes">
            <img src="/assets/product-icons/hive.png" width="76" height="76" alt="" loading="lazy" />
            <span><strong>Agentes</strong><span>Especialistas de IA que comparten contexto y coordinan las tareas alrededor de tu objetivo.</span></span>
            <b aria-hidden="true">↗</b>
          </Link>
          <Link to="/productos#nexus">
            <img src="/assets/product-icons/nexus.png" width="76" height="76" alt="" loading="lazy" />
            <span><strong>Nexus</strong><span>La conexión entre herramientas y sistemas para que la información continúe su recorrido.</span></span>
            <b aria-hidden="true">↗</b>
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Sobre Uonify (`/sobre-uonify`, #view-empresa): lo que creas tiene muchas posibilidades. */
export function SobreUonifyPage() {
  return (
    <PublicView view={PUBLIC_VIEWS.empresa} sheets={SHEETS}>
      <PageHeader current="empresa" loginLabel="Tu espacio Uonify" />
      <main id="contenido" tabIndex={-1}>
        <AboutOpening />
        <AboutPurpose />
        <AboutJourney />
        <AboutTechnology />
        <section className="about-closing wrap" id="crecer" aria-labelledby="grow-title">
          <img data-uonify-logo="relief" className="closing-mark" src="/assets/brands/uonify-isotipo-3d.webp" width="44" height="44" alt="" loading="lazy" />
          <h2 id="grow-title">Queremos crecer ayudando <br />a que más personas <br /><span>puedan hacerlo también.</span></h2>
          <p>El taller es solo una manera de contarlo. Puede ser tu primera colección, una tienda que ya conoces bien o un proyecto que todavía estás imaginando.</p>
          <div className="start-actions">
            <HomeLink className="button primary" to={PATHS.composer}>Empieza ahora <span aria-hidden="true">↗</span></HomeLink>
            <Link className="button secondary" to={PATHS.productos}>Descubre las herramientas</Link>
          </div>
          <Link className="closing-news" to={PATHS.novedades}>Novedades de Uonify <span aria-hidden="true">↗</span></Link>
        </section>
      </main>
      <PageFooter links={FOOTER} note="Uonify · Hazlo posible." />
    </PublicView>
  );
}
