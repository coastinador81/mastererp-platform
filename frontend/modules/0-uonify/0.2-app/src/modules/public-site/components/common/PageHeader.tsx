import { Link } from 'react-router';
import { PATHS, type PublicViewKey } from '../../model/views';
import { HomeLink } from './HomeLink';
import { LoginLink } from './LoginLink';
import { ServicesButton } from './ServicesButton';
import { SkipLink } from './SkipLink';

type NavItem = { view: PublicViewKey; to: string; label: string };

/**
 * Menú comercial completo de las páginas interiores (D-HOME-REORG-20261109), en DOS filas
 * con las 10 páginas siempre a la vista (decisión del dueño 09-11-2026: «dos filas, todo
 * visible»). Fila 1: lo que ofrece Uonify; fila 2: la empresa y su comunidad. Son dos
 * filas de enlaces, no menús desplegables. «Ayuda» va al pie global; «Servicios» es la
 * página de productos. Se muestra igual con y sin sesión. A la derecha, como en la
 * portada: «Iniciar sesión» y el botón de servicios.
 */
const NAV_ROWS: ReadonlyArray<ReadonlyArray<NavItem>> = [
  [
    { view: 'producto', to: PATHS.productos, label: 'Servicios' },
    { view: 'lo-que-puedes-hacer', to: PATHS.loQuePuedesHacer, label: 'Lo que puedes hacer' },
    { view: 'como-funciona', to: PATHS.comoFunciona, label: 'Cómo funciona' },
    { view: 'precios', to: PATHS.precios, label: 'Precios' },
    { view: 'para-empresas', to: PATHS.paraEmpresas, label: 'Para equipos y marcas' },
  ],
  [
    { view: 'empresa', to: PATHS.sobreUonify, label: 'Sobre Uonify' },
    { view: 'seguridad', to: PATHS.seguridad, label: 'Seguridad' },
    { view: 'partners', to: PATHS.partners, label: 'Partners' },
    { view: 'clientes', to: PATHS.clientes, label: 'Clientes' },
    { view: 'novedades', to: PATHS.novedades, label: 'Novedades' },
  ],
];

/** Cabecera de las páginas públicas (todas menos la portada y las legales). */
export function PageHeader({ current, loginLabel }: { current: PublicViewKey; loginLabel: string }) {
  return (
    <>
      <SkipLink />
      <header className="header header--rows">
        <HomeLink className="brand" brand aria-label="Uonify, inicio">
          <img data-uonify-logo="relief" src="/assets/brands/uonify-wordmark-3d.webp" width="126" height="40" alt="Uonify" />
        </HomeLink>
        <div className="header-actions">
          <LoginLink pageLabel={loginLabel} />
          <ServicesButton />
        </div>
        <nav className="main-nav main-nav--rows" aria-label="Navegación principal">
          {NAV_ROWS.map((row, index) => (
            <div className="nav-row" key={index}>
              {row.map(item => (
                <Link key={item.to} to={item.to} aria-current={item.view === current ? 'page' : undefined}>{item.label}</Link>
              ))}
            </div>
          ))}
        </nav>
      </header>
    </>
  );
}
