import productosCss from '../../styles/pages/productos.css?inline';
import juegoCss from '../../styles/pages/juego-uonify.css?inline';
import galeriaCss from '../../styles/pages/galeria-imagenes.css?inline';
import adminErpCss from '../../styles/pages/admin-erp.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PUBLIC_VIEWS } from '../../model/views';
import { PageFooter, SITE_FOOTER_LINKS } from '../common/PageFooter';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';
import { AdminErpSection } from './AdminErpSection';
import { AiSection } from './AiSection';
import { FamilySection, StartAndExplore } from './FamilySection';
import { FichaStory } from './FichaStory';
import { ProductGallery } from './ProductGallery';
import { SectionNav } from './SectionNav';
import { ReviewStory, WritingStory } from './StoryPanels';
import { UniverseSection } from './UniverseSection';

const SHEETS = viewSheets(productosCss, juegoCss, galeriaCss, adminErpCss);
const FOOTER = SITE_FOOTER_LINKS;

/** Productos (`/productos`, #view-producto): el universo Uonify y la ficha de ejemplo. */
export function ProductosPage() {
  return (
    <PublicView view={PUBLIC_VIEWS.producto} sheets={SHEETS}>
      <PageHeader current="producto" loginLabel="Iniciar sesión" />
      <main id="contenido" tabIndex={-1}>
        <UniverseSection />
        <SectionNav />
        <section className="catalog-section wrap" id="catalogo" aria-labelledby="catalog-title">
          <div className="catalog-hero">
            <div className="catalog-hero-copy">
              <p className="eyebrow">UONIFY PRODUCTOS</p>
              <h2 id="catalog-title">Tu catálogo.{' '}<br />Con todas sus{' '}<br /><span>posibilidades.</span></h2>
              <p>Información, imágenes, contenido y canales.{' '}<br />Todo alrededor de lo más importante: tu producto.</p>
              <a className="button primary" href="#producto-en-accion">Descubre lo que puedes hacer <span aria-hidden="true">↓</span></a>
            </div>
            <img className="catalog-character" src="/assets/productos/catalogo.png" width="1200" height="1200" alt="El personaje de Productos: fichas azules y aqua con una sonrisa abierta" fetchPriority="high" />
            <span className="hero-caption">Una ficha. Muchas posibilidades.</span>
          </div>
          <div className="section-heading" id="producto-en-accion">
            <p className="eyebrow">DE LA INFORMACIÓN A LA ACCIÓN</p>
            <h2>Todo lo que hace único{' '}<br />a tu producto, en un lugar.</h2>
            <p>Una ficha bien construida es el principio. Descubre cómo darle forma, enriquecerla y prepararla para cada canal.</p>
          </div>
          <div id="product-stories">
            <FichaStory />
            <div className="visual-stories">
              <ProductGallery />
              <WritingStory />
            </div>
            <ReviewStory />
          </div>
        </section>
        <AiSection />
        <AdminErpSection />
        <FamilySection />
        <StartAndExplore />
      </main>
      <PageFooter links={FOOTER} note="Uonify · Hazlo posible." />
    </PublicView>
  );
}
