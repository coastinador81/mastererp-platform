import { Link } from 'react-router';
import { PATHS, type PublicViewKey } from '../../model/views';
import { HomeLink } from './HomeLink';
import { LoginLink } from './LoginLink';
import { SkipLink } from './SkipLink';

/**
 * Menú principal (D-WEB-PUBLICA-20261022): Cómo funciona · Servicios · Lo que puedes
 * hacer · Precios · Ayuda. «Servicios» es la página de productos; «Ayuda» es el centro
 * de ayuda (módulo help), así que no lleva clave de vista. Novedades queda fuera hasta
 * el lanzamiento; Seguridad va en el pie.
 */
const MAIN_NAV: ReadonlyArray<{ view?: PublicViewKey; to: string; label: string }> = [
  { view: 'como-funciona', to: PATHS.comoFunciona, label: 'Cómo funciona' },
  { view: 'producto', to: PATHS.productos, label: 'Servicios' },
  { view: 'lo-que-puedes-hacer', to: PATHS.loQuePuedesHacer, label: 'Lo que puedes hacer' },
  { view: 'precios', to: PATHS.precios, label: 'Precios' },
  { to: '/ayuda', label: 'Ayuda' },
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
            <Link key={item.to} to={item.to} aria-current={item.view && item.view === current ? 'page' : undefined}>{item.label}</Link>
          ))}
        </nav>
        <LoginLink pageLabel={loginLabel} />
      </header>
    </>
  );
}
