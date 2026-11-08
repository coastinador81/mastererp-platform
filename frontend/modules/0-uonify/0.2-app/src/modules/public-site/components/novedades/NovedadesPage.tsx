import productosCss from '../../styles/pages/productos.css?inline';
import novedadesCss from '../../styles/pages/novedades.css?inline';
import juegoCss from '../../styles/pages/juego-uonify.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PUBLIC_VIEWS } from '../../model/views';
import { FOOTER_LINKS, PageFooter } from '../common/PageFooter';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';
import { KitAnimation } from './KitAnimation';
import { NewsAll, NewsBuilding, NewsProductStory, NewsTwoStories } from './NewsSections';

const SHEETS = viewSheets(productosCss, novedadesCss, juegoCss);
const FOOTER = [FOOTER_LINKS.productos, FOOTER_LINKS.sobreUonify, FOOTER_LINKS.privacidad, FOOTER_LINKS.terminos];

/** Novedades (`/novedades`): nuevas piezas, más posibilidades. */
export function NovedadesPage() {
  return (
    <PublicView view={PUBLIC_VIEWS.novedades} sheets={SHEETS}>
      <PageHeader current="novedades" loginLabel="Tu espacio Uonify" />
      <main id="contenido" tabIndex={-1}>
        <section className="news-opening wrap" aria-labelledby="news-title">
          <div className="news-heading">
            <p className="eyebrow">NOVEDADES DE UONIFY</p>
            <h1 id="news-title">Nuevas piezas.{' '}<br /><span>Más posibilidades.</span></h1>
            <p>Lo que estamos creando, lo que va tomando forma{' '}<br />y lo que te ayudará a llevar tus ideas más lejos.</p>
          </div>
          <article className="news-feature" aria-labelledby="feature-title">
            <KitAnimation />
            <div className="news-feature-copy">
              <p className="news-label"><img src="/assets/product-icons/catalogo.png" width="42" height="42" alt="" />EL PRIMER SERVICIO · PRODUCTOS</p>
              <h2 id="feature-title">Todo empieza{' '}<br />por lo que <span>vendes.</span></h2>
              <p>Una idea toma forma cuando reúnes sus piezas. Un catálogo, cuando conectas su información, sus imágenes y la historia que quieres contar.</p>
              <p>Empezamos por Productos: el lugar donde preparar cada ficha y descubrir todo lo que puede llegar a ser.</p>
              <a className="button primary" href="#productos">Mira cómo toma forma <span aria-hidden="true">↓</span></a>
            </div>
          </article>
          <p className="kit-caption">Un juego imaginado a partir de los personajes de Uonify. Nos ayuda a mostrar las herramientas; no es un juguete a la venta.</p>
          <nav className="news-index" aria-label="En esta página">
            <a href="#productos">Productos en acción <span aria-hidden="true">↓</span></a>
            <a href="#construyendo">Lo que estamos construyendo <span aria-hidden="true">↓</span></a>
            <a href="#todas">Todas las novedades <span aria-hidden="true">↓</span></a>
          </nav>
        </section>
        <section className="news-products wrap" id="productos" aria-labelledby="possibilities-title">
          <div className="news-section-heading">
            <p className="eyebrow">PRODUCTOS EN ACCIÓN</p>
            <h2 id="possibilities-title">Del juego de piezas{' '}<br /><span>a un producto con historia.</span></h2>
            <p>Imagina que este es tu próximo producto. Así se conectan la información, las imágenes y las palabras que necesitas para presentarlo.</p>
          </div>
          <NewsProductStory />
          <NewsTwoStories />
          <p className="news-example-note">Recorridos ilustrativos de la propuesta. Los ejemplos de texto están preparados; no se conectan cuentas ni se ejecutan acciones reales.</p>
        </section>
        <NewsBuilding />
        <NewsAll />
      </main>
      <PageFooter links={FOOTER} note="Novedades de Uonify · Propuesta de experiencia" />
    </PublicView>
  );
}
