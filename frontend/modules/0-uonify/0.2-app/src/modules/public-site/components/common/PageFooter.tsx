import { PATHS } from '../../model/views';
import { HomeFooter } from '../home/HomeFooter';

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
  partners: { to: PATHS.partners, label: 'Partners' },
  clientes: { to: PATHS.clientes, label: 'Clientes' },
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
  FOOTER_LINKS.partners,
  FOOTER_LINKS.clientes,
  FOOTER_LINKS.sobreUonify,
  FOOTER_LINKS.privacidad,
  FOOTER_LINKS.terminos,
];

/**
 * Pie común de TODAS las páginas públicas: es exactamente el de la portada (HomeFooter),
 * sin variantes por página (decisión del dueño, 08-11-2026). Se conserva la firma con
 * `links`/`note` por compatibilidad con las páginas que aún los pasan; no se usan.
 */
export function PageFooter(_props: { links: readonly FooterLink[]; note: string }) {
  return <HomeFooter />;
}
