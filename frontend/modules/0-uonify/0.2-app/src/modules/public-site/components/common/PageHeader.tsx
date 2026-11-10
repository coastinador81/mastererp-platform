import { useState } from 'react';
import { Link } from 'react-router';
import headerCss from '../../styles/common/page-header.css?inline';
import { useHydrated } from '../../hooks/useHydrated';
import { useViewStyles } from '../../hooks/useViewStyles';
import type { PublicViewKey } from '../../model/views';
import { MobileNav } from './header/MobileNav';
import { NavDropdown } from './header/NavDropdown';
import { entryHas, HEADER_ENTRIES } from './header/navModel';
import { HomeLink } from './HomeLink';
import { LoginLink } from './LoginLink';
import { ServicesButton } from './ServicesButton';
import { SkipLink } from './SkipLink';

/** Hoja propia de la cabecera (constante de módulo): useViewStyles la inyecta y el prerender la enlaza. */
const SHEETS: readonly string[] = [headerCss];

interface PageHeaderProps {
  /** Página del menú que se marca como actual. Ayuda y las legales no están en el menú: ninguna. */
  current?: PublicViewKey;
  /** Texto del acceso mientras se consulta la sesión (también en el HTML prerenderizado). */
  loginLabel: string;
  /**
   * La puerta de DEV sirve la página también sin JS, a partir de su HTML prerenderizado (/terminos y
   * /privacidad): ahí no puede quedar ningún botón muerto. Hasta hidratar, los grupos son enlaces a
   * su primera página y no se pintan ni el botón de servicios ni el del menú.
   */
  noJs?: boolean;
}

/**
 * Cabecera de todas las páginas públicas menos la portada: las 10 interiores, Ayuda y sus artículos y
 * el centro legal. Una sola fila, fija arriba, como en las webs de Google (elección del dueño,
 * 10-11-2026: «La A»): el logo; «Servicios» y «Empresa», que se despliegan con cada página y su frase;
 * Cómo funciona, Precios y Clientes; y a la derecha el acceso y el botón de servicios. Por debajo de
 * 1024 px, el menú pasa a un botón con las tres líneas (styles/common/page-header.css).
 */
export function PageHeader({ current, loginLabel, noJs = false }: PageHeaderProps) {
  useViewStyles('page-header', SHEETS);
  // Siempre interactiva en el navegador (useHydrated es true desde el primer pintado); en el HTML
  // prerenderizado, salvo en las páginas que la puerta sirve sin JS.
  const interactive = useHydrated() || !noJs;
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <>
      <SkipLink />
      <header className="header header--row">
        <HomeLink className="brand" brand aria-label="Uonify, inicio">
          <img data-uonify-logo="relief" src="/assets/brands/uonify-wordmark-3d.webp" width="126" height="40" alt="Uonify" />
        </HomeLink>
        <nav className="hnav" aria-label="Navegación principal">
          {HEADER_ENTRIES.map(entry => {
            const className = entryHas(entry, current) ? 'hnav-item is-active' : 'hnav-item';
            if (entry.kind === 'link') return (
              <Link key={entry.page.to} to={entry.page.to} className={className} aria-current={entry.page.view === current ? 'page' : undefined}>{entry.page.label}</Link>
            );
            if (!interactive) return <Link key={entry.key} to={entry.pages[0].to} className={className}>{entry.label}</Link>;
            return (
              <NavDropdown
                key={entry.key}
                id={`hnav-${entry.key}`}
                label={entry.label}
                pages={entry.pages}
                current={current}
                active={entryHas(entry, current)}
                open={openGroup === entry.key}
                onToggle={open => setOpenGroup(open ? entry.key : null)}
              />
            );
          })}
        </nav>
        <div className="header-actions">
          <LoginLink pageLabel={loginLabel} />
          {interactive && <ServicesButton />}
          {interactive && <MobileNav entries={HEADER_ENTRIES} current={current} open={mobileOpen} onToggle={setMobileOpen} />}
        </div>
      </header>
    </>
  );
}
