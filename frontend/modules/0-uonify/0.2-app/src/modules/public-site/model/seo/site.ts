/**
 * Datos de Uonify que comparten las etiquetas de la cabecera, el JSON-LD, llms.txt y
 * el sitemap. Contacto y razón social: decisiones del dueño (hola@uonify.com,
 * ETHICS CLOUD & SECURITY SERVICES LLC; «Uonify» es el nombre comercial).
 */
export interface SeoImage {
  /** Ruta pública (se sirve desde /assets). */
  path: string;
  width: number;
  height: number;
  alt: string;
}

export const SITE = {
  name: 'Uonify',
  legalName: 'ETHICS CLOUD & SECURITY SERVICES LLC',
  email: 'hola@uonify.com',
  slogan: 'Hazlo posible',
  /** Idioma de todas las páginas (hreflang, og:locale, inLanguage). */
  hreflang: 'es',
  language: 'es-ES',
  ogLocale: 'es_ES',
  description:
    'Uonify es una plataforma de e-commerce con inteligencia artificial que reúne tus productos, tus canales y tu equipo en un mismo espacio. Prepara fichas, imágenes, contenido A+, modelos 3D y vídeo, y llévalos a Amazon y a tu tienda online con Uony, la IA de Uonify. La inteligencia artificial y la creación de contenido funcionan con la tecnología de Google y las pagas a Google, a sus precios y sin recargo de Uonify.',
  logo: { path: '/assets/brands/uonify-favicon-3d.png', width: 128, height: 128, alt: 'Isotipo de Uonify' },
} as const satisfies Record<string, unknown>;

/** Imagen para compartir cuando la página no tiene una propia (sin transparencias). */
export const DEFAULT_IMAGE: SeoImage = {
  path: '/assets/sobre-uonify/trabajo-cotidiano.png',
  width: 1672,
  height: 941,
  alt: 'Una artesana revisa una taza azul y blanca mientras un compañero prepara un envío en su taller',
};

/**
 * Cabecera por defecto de la aplicación (index.html). Se vuelve a ella al salir de una
 * página pública, así el espacio de trabajo y el panel de admin quedan siempre en noindex.
 */
export const SHELL_HEAD = {
  title: 'Uonify — Hazlo posible',
  description: 'Uonify: productos, servicios y espacio de trabajo en una sola experiencia.',
  robots: 'noindex, nofollow',
} as const;

/** Rastreadores de IA a los que se abre la web en el lanzamiento (mismas reglas que el resto). */
export const AI_CRAWLERS: readonly string[] = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
];

/** Zonas privadas que nunca se rastrean (sesión, administración y API). */
export const PRIVATE_PATHS: readonly string[] = ['/espacio', '/admin', '/api/'];
