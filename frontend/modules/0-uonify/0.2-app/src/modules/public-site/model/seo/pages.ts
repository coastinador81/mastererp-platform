import { PUBLIC_VIEWS, type PublicViewKey } from '../views';
import { DEFAULT_IMAGE, type SeoImage } from './site';
import type { SeoPage } from './types';

/**
 * Imágenes propias de algunas páginas para compartir: PNG sin transparencias (algunas
 * redes no leen WebP) de las ilustraciones que ya usa la web.
 */
const IMAGES: Partial<Record<PublicViewKey, SeoImage>> = {
  producto: {
    path: '/assets/sobre-uonify/preparar-catalogo-v44.png',
    width: 1448,
    height: 1086,
    alt: 'La artesana prepara una taza azul y blanca sobre papel claro para presentarla en su catálogo',
  },
  'para-empresas': {
    path: '/assets/sobre-uonify/entender-negocio-v44.png',
    width: 1448,
    height: 1086,
    alt: 'La misma artesana revisa una libreta junto a su portátil y las piezas azules del taller',
  },
};

/** Nombre corto de cada página en las migas (BreadcrumbList). */
const CRUMBS: Record<Exclude<PublicViewKey, 'portada'>, string> = {
  producto: 'Servicios',
  'como-funciona': 'Cómo funciona',
  'lo-que-puedes-hacer': 'Lo que puedes hacer',
  precios: 'Precios',
  partners: 'Partners',
  clientes: 'Clientes',
  seguridad: 'Seguridad',
  'para-empresas': 'Para equipos y marcas',
  empresa: 'Sobre Uonify',
  novedades: 'Novedades',
  privacidad: 'Privacidad',
  terminos: 'Condiciones',
};

const PAGE_TYPES: Partial<Record<PublicViewKey, SeoPage['pageType']>> = {
  empresa: 'AboutPage',
  novedades: 'CollectionPage',
};

function pageFor(key: PublicViewKey): SeoPage {
  const view = PUBLIC_VIEWS[key];
  return {
    path: view.path,
    title: view.title,
    description: view.description,
    image: IMAGES[key] ?? DEFAULT_IMAGE,
    breadcrumbs: key === 'portada' ? undefined : [{ name: CRUMBS[key], path: view.path }],
    pageType: PAGE_TYPES[key] ?? 'WebPage',
    // La portada, Servicios y Precios presentan el servicio y su plan.
    software: key === 'portada' || key === 'producto' || key === 'precios',
  };
}

/** Datos SEO de cada vista pública (título y descripción salen de PUBLIC_VIEWS). */
export const SEO_PAGES: Readonly<Record<PublicViewKey, SeoPage>> = Object.freeze(
  Object.fromEntries((Object.keys(PUBLIC_VIEWS) as PublicViewKey[]).map(key => [key, pageFor(key)])) as Record<PublicViewKey, SeoPage>,
);

/** Portada del centro de ayuda, por si el módulo help no declara su propia cabecera. */
export const HELP_HOME_SEO: SeoPage = {
  path: '/ayuda',
  title: 'Centro de ayuda — Uonify',
  description: 'Guías y respuestas sobre Uonify: acceso, suscripción y pago, lo que pagas a Google, tus productos y Uony. Y, si lo necesitas, el soporte de nuestro equipo.',
  breadcrumbs: [{ name: 'Ayuda', path: '/ayuda' }],
  image: DEFAULT_IMAGE,
  pageType: 'CollectionPage',
};
