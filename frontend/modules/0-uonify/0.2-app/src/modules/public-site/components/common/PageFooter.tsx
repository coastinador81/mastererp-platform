import { Link } from 'react-router';
import { PATHS } from '../../model/views';
import { HomeLink } from './HomeLink';

export interface FooterLink { to: string; label: string }

/** Enlaces del pie que se repiten entre páginas. */
export const FOOTER_LINKS = {
  productos: { to: PATHS.productos, label: 'Servicios' },
  loQuePuedesHacer: { to: PATHS.loQuePuedesHacer, label: 'Lo que puedes hacer' },
  precios: { to: PATHS.precios, label: 'Precios' },
  ayuda: { to: '/ayuda', label: 'Ayuda' },
  seguridad: { to: PATHS.seguridad, label: 'Seguridad' },
  sobreUonify: { to: PATHS.sobreUonify, label: 'Sobre Uonify' },
  novedades: { to: PATHS.novedades, label: 'Novedades' },
  paraEmpresas: { to: PATHS.paraEmpresas, label: 'Para equipos y marcas' },
  comoFunciona: { to: PATHS.comoFunciona, label: 'Cómo funciona' },
  privacidad: { to: PATHS.privacidad, label: 'Privacidad' },
  terminos: { to: PATHS.terminos, label: 'Condiciones' },
} satisfies Record<string, FooterLink>;

/**
 * Pie común de las páginas públicas. Las páginas legales (Privacidad y Condiciones) son
 * las rutas vivas hoy; el resto de textos legales se añadirán al pie cuando tengan ruta
 * y estén revisados por el hilo Legal.
 */
export const SITE_FOOTER_LINKS: readonly FooterLink[] = [
  FOOTER_LINKS.comoFunciona,
  FOOTER_LINKS.productos,
  FOOTER_LINKS.loQuePuedesHacer,
  FOOTER_LINKS.precios,
  FOOTER_LINKS.ayuda,
  FOOTER_LINKS.seguridad,
  FOOTER_LINKS.paraEmpresas,
  FOOTER_LINKS.sobreUonify,
  FOOTER_LINKS.privacidad,
  FOOTER_LINKS.terminos,
];

/** Pie de las páginas públicas: logotipo, enlaces y nota de la página. */
export function PageFooter({ links, note }: { links: readonly FooterLink[]; note: string }) {
  return (
    <footer className="footer wrap">
      <HomeLink className="brand" brand>
        <img data-uonify-logo="relief" src="/assets/brands/uonify-wordmark-mono-3d.webp" width="115" height="36" alt="Uonify" />
      </HomeLink>
      <nav aria-label="Enlaces del pie">
        {links.map(link => <Link key={link.to} to={link.to}>{link.label}</Link>)}
      </nav>
      <p>{note}</p>
    </footer>
  );
}
