import productosCss from '../../styles/pages/productos.css?inline';
import clientesCss from '../../styles/pages/clientes.css?inline';
import { viewSheets } from '../../styles/sheets';
import { PATHS, PUBLIC_VIEWS } from '../../model/views';
import { HomeLink } from '../common/HomeLink';
import { PageFooter, SITE_FOOTER_LINKS } from '../common/PageFooter';
import { PageHeader } from '../common/PageHeader';
import { PublicView } from '../common/PublicView';

const SHEETS = viewSheets(productosCss, clientesCss);

/** Marcas que trabajan con Uonify (solo las confirmadas por el dueño). El logo oficial se
 *  añade con su material autorizado; sin él se muestra el nombre, nunca un logo copiado. */
interface Cliente { name: string; logo?: string }
const CLIENTES: readonly Cliente[] = [
  { name: 'Rentprive', logo: '/assets/clientes/rentprive.png' },
  { name: 'Exquisit' },
  { name: 'InnovaGoods' },
];

/** Clientes (`/clientes`): marcas que avalan Uonify. */
export function ClientesPage() {
  return (
    <PublicView view={PUBLIC_VIEWS.clientes} sheets={SHEETS}>
      <PageHeader current="clientes" loginLabel="Tu espacio Uonify" />
      <main id="contenido" tabIndex={-1}>
        <section className="cli-hero wrap" aria-labelledby="cli-title">
          <p className="eyebrow">CLIENTES</p>
          <h1 id="cli-title">Marcas que trabajan <span>con Uonify.</span></h1>
          <p className="lead">Empresas que usan Uonify para preparar sus productos, su contenido y su operación. Cada logo se publica con el material oficial y la autorización de la marca.</p>
        </section>

        <section className="cli-wall wrap" aria-label="Marcas">
          {CLIENTES.map(cliente => (
            <div className="clogo" key={cliente.name}>
              {cliente.logo
                ? <img src={cliente.logo} alt={cliente.name} loading="lazy" />
                : <span className="clogo-name">{cliente.name}</span>}
            </div>
          ))}
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
