import productosCss from '../../styles/pages/productos.css?inline';
import clientesCss from '../../styles/pages/clientes.css?inline';
import richCss from '../../styles/pages/rich.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PATHS, PUBLIC_VIEWS } from '../../model/views';
import { DeviceFrame } from '../common/DeviceFrame';
import { HomeLink } from '../common/HomeLink';
import { PageFooter, SITE_FOOTER_LINKS } from '../common/PageFooter';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';

const SHEETS = viewSheets(productosCss, clientesCss, richCss);

/** Marcas que trabajan con Uonify (solo las confirmadas por el dueño). El logo oficial se
 *  añade con su material autorizado; sin él se muestra el nombre, nunca un logo copiado. */
interface Cliente { name: string; logo?: string }
const CLIENTES: readonly Cliente[] = [
  // Logos oficiales (sin redibujar): Rentprive (manual de Rentprive); Exquisit (exquisit.de,
  // versión negativa/blanca); InnovaGoods (innovagoods.com, versión blanca). Monocromo blanco sobre Tinta.
  { name: 'Rentprive', logo: '/assets/clientes/rentprive.png' },
  { name: 'Exquisit', logo: '/assets/clientes/exquisit.svg' },
  { name: 'InnovaGoods', logo: '/assets/clientes/innovagoods.png' },
];

/** Clientes (`/clientes`): marcas que avalan Uonify. */
export function ClientesPage() {
  return (
    <PublicView view={PUBLIC_VIEWS.clientes} sheets={SHEETS}>
      <PageHeader current="clientes" loginLabel="Tu espacio Uonify" />
      <main id="contenido" tabIndex={-1}>
        <section className="hero-split wrap" aria-labelledby="cli-title">
          <div className="hero-copy">
            <p className="eyebrow">CLIENTES</p>
            <h1 id="cli-title">Marcas que trabajan <span>con Uonify.</span></h1>
            <p className="lead">Empresas que usan Uonify para preparar sus productos, su contenido y su operación, con Uony de copiloto. Cada logo se publica con el material oficial y la autorización de la marca.</p>
            <HomeLink className="button primary" to={PATHS.composer}>Empieza ahora</HomeLink>
          </div>
          <div className="hero-illo hero-glow">
            <img src="/assets/product-icons/catalogo.png" width="340" height="340" alt="Personaje de catálogo de Uonify" fetchPriority="high" />
          </div>
        </section>

        <section className="logo-strip-section wrap" aria-label="Marcas que usan Uonify">
          <p className="strip-label">Empresas que ya usan Uonify</p>
          <div className="logo-strip">
            {CLIENTES.map(cliente => (
              <div className="logo-cell" key={cliente.name}>
                {cliente.logo
                  ? <img src={cliente.logo} alt={cliente.name} loading="lazy" />
                  : <span className="logo-name">{cliente.name}</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="alt-section wrap" aria-labelledby="cli-ficha-title">
          <div className="alt-copy">
            <p className="kicker">Producto</p>
            <h2 id="cli-ficha-title">De la ficha a cada canal, sin repetir trabajo.</h2>
            <p>Preparan la ficha una vez —datos, atributos, GPSR— y la adaptan a cada destino. Uony reúne el contexto y deja cada decisión en sus manos.</p>
            <ul>
              <li>Ficha maestra con sus imágenes y su vídeo.</li>
              <li>Lista para la cuenta de vendedor de Amazon y para su tienda.</li>
              <li>Todo con su visto bueno antes de publicar.</li>
            </ul>
          </div>
          <div className="alt-media">
            <DeviceFrame illo="catalogo" label="Ficha de producto en Uonify" alt="Ficha de producto en Uonify" />
          </div>
        </section>

        <section className="alt-section reverse wrap" aria-labelledby="cli-estudio-title">
          <div className="alt-copy">
            <p className="kicker">Estudio</p>
            <h2 id="cli-estudio-title">Contenido que vende, creado con Uony.</h2>
            <p>Imágenes y vídeos de producto con inteligencia artificial, partiendo de sus fotos o desde cero. Ven el precio antes de crear y aprueban cada pieza.</p>
          </div>
          <div className="alt-media">
            <DeviceFrame illo="estudio" label="Estudio creativo de Uonify" alt="Estudio creativo de Uonify" />
          </div>
        </section>

        <section className="cli-cta wrap" aria-labelledby="cli-cta-title">
          <h2 id="cli-cta-title">¿Quieres ser el próximo?</h2>
          <p>Entra en Uonify y empieza a trabajar con Uony hoy mismo.</p>
          <HomeLink className="button primary" to={PATHS.composer}>Empieza ahora</HomeLink>
        </section>
      </main>
      <PageFooter links={SITE_FOOTER_LINKS} note="Uonify · Clientes." />
    </PublicView>
  );
}
