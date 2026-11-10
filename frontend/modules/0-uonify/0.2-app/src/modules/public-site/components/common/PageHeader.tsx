import { Link } from 'react-router';
import headerCss from '../../styles/common/page-header.css?inline';
import { useHydrated } from '../../hooks/useHydrated';
import { useViewStyles } from '../../hooks/useViewStyles';
import { PATHS, type PublicViewKey } from '../../model/views';
import { HomeLink } from './HomeLink';
import { LoginLink } from './LoginLink';
import { ServicesButton } from './ServicesButton';
import { SkipLink } from './SkipLink';

/** Hoja propia de la cabecera (constante de módulo): useViewStyles la inyecta y el prerender la enlaza. */
const SHEETS: readonly string[] = [headerCss];

type NavItem = { view: PublicViewKey; to: string; label: string };

/**
 * Menú comercial completo (D-HOME-REORG-20261109), en DOS filas con las 10 páginas siempre a la
 * vista (decisión del dueño 09-11-2026: «dos filas, todo visible»). Fila 1: lo que ofrece Uonify;
 * fila 2: la empresa y su comunidad. Son dos filas de enlaces, no menús desplegables. «Ayuda» va
 * al pie global; «Servicios» es la página de productos.
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

interface PageHeaderProps {
  /** Página del menú que se marca como actual. Ayuda y las legales no están en el menú: ninguna. */
  current?: PublicViewKey;
  /** Texto del acceso mientras se consulta la sesión (también en el HTML prerenderizado). */
  loginLabel: string;
  /**
   * La puerta de DEV sirve la página también sin JS, a partir de su HTML prerenderizado (/terminos y
   * /privacidad): el botón de servicios solo se pinta con JS, para no dejar un control muerto.
   */
  noJs?: boolean;
}

/**
 * Cabecera de todas las páginas públicas menos la portada: las 10 interiores, Ayuda y sus
 * artículos y el centro legal. La misma en todas, con y sin sesión: el logo, el menú en dos filas
 * y, a la derecha como en la portada, el acceso («Iniciar sesión» o «Volver a mi espacio») y el
 * botón de servicios. Fija arriba en escritorio y estática en móvil (styles/common/page-header.css).
 */
export function PageHeader({ current, loginLabel, noJs = false }: PageHeaderProps) {
  useViewStyles('page-header', SHEETS);
  // Botón de servicios: siempre en el navegador (useHydrated es true desde el primer pintado);
  // en el HTML prerenderizado, salvo en las páginas que la puerta sirve sin JS.
  const services = useHydrated() || !noJs;
  return (
    <>
      <SkipLink />
      <header className="header header--rows">
        <HomeLink className="brand" brand aria-label="Uonify, inicio">
          <img data-uonify-logo="relief" src="/assets/brands/uonify-wordmark-3d.webp" width="126" height="40" alt="Uonify" />
        </HomeLink>
        {/* Sin el botón, la fila guarda su alto: la cabecera mide lo mismo y no salta al llegar el JS. */}
        <div className={services ? 'header-actions' : 'header-actions header-actions--no-js'}>
          <LoginLink pageLabel={loginLabel} />
          {services && <ServicesButton />}
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
