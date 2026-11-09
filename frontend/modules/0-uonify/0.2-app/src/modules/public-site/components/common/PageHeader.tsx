import { Link } from 'react-router';
import { PATHS, type PublicViewKey } from '../../model/views';
import { HomeLink } from './HomeLink';
import { LoginLink } from './LoginLink';
import { SkipLink } from './SkipLink';

/**
 * Menú comercial completo de las páginas interiores (D-HOME-REORG-20261109): Servicios,
 * Lo que puedes hacer, Precios, Para equipos y marcas, Seguridad, Novedades, Partners,
 * Clientes, Sobre Uonify y Cómo funciona. Se muestra igual con y sin sesión. «Ayuda»
 * pasa al pie global; «Servicios» es la página de productos.
 */
const MAIN_NAV: ReadonlyArray<{ view: PublicViewKey; to: string; label: string }> = [
  { view: 'producto', to: PATHS.productos, label: 'Servicios' },
  { view: 'lo-que-puedes-hacer', to: PATHS.loQuePuedesHacer, label: 'Lo que puedes hacer' },
  { view: 'precios', to: PATHS.precios, label: 'Precios' },
  { view: 'para-empresas', to: PATHS.paraEmpresas, label: 'Para equipos y marcas' },
  { view: 'seguridad', to: PATHS.seguridad, label: 'Seguridad' },
  { view: 'novedades', to: PATHS.novedades, label: 'Novedades' },
  { view: 'partners', to: PATHS.partners, label: 'Partners' },
  { view: 'clientes', to: PATHS.clientes, label: 'Clientes' },
  { view: 'empresa', to: PATHS.sobreUonify, label: 'Sobre Uonify' },
  { view: 'como-funciona', to: PATHS.comoFunciona, label: 'Cómo funciona' },
];

/** Cabecera de las páginas públicas (todas menos la portada y las legales). */
export function PageHeader({ current, loginLabel }: { current: PublicViewKey; loginLabel: string }) {
  return (
    <>
      <SkipLink />
      <header className="header">
        <HomeLink className="brand" brand aria-label="Uonify, inicio">
          <img data-uonify-logo="relief" src="/assets/brands/uonify-wordmark-3d.webp" width="126" height="40" alt="Uonify" />
        </HomeLink>
        <nav className="main-nav" aria-label="Navegación principal">
          {MAIN_NAV.map(item => (
            <Link key={item.to} to={item.to} aria-current={item.view === current ? 'page' : undefined}>{item.label}</Link>
          ))}
        </nav>
        <LoginLink pageLabel={loginLabel} />
      </header>
    </>
  );
}
