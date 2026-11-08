import type { SeoImage } from './site';

/** Nodo JSON-LD de schema.org (objeto serializable). */
export type JsonLdNode = { '@type': string | readonly string[]; '@id'?: string } & Record<string, unknown>;

export interface SeoCrumb {
  name: string;
  path: string;
}

export interface SeoQuestion {
  question: string;
  answer: string;
}

/**
 * Lo que una página pública declara para buscadores y buscadores de IA. Lo usan
 * useSeoHead (en el navegador) y el prerender (al compilar). Otros módulos con
 * páginas públicas (p. ej. el centro de ayuda) pasan lo mismo a useSeoHead.
 */
export interface SeoPage {
  /** Ruta canónica (sin dominio ni barra final): «/productos». */
  path: string;
  /** <title> y og:title. */
  title: string;
  /** Meta descripción (unos 150-160 caracteres) y og:description. */
  description: string;
  /** Migas desde la portada, sin incluirla; la última es la propia página. */
  breadcrumbs?: readonly SeoCrumb[];
  /** Imagen para compartir; por defecto DEFAULT_IMAGE. */
  image?: SeoImage;
  /** og:type: «article» para artículos de ayuda o novedades. */
  type?: 'website' | 'article';
  /** Tipo schema.org de la página (WebPage por defecto). */
  pageType?: 'WebPage' | 'AboutPage' | 'CollectionPage' | 'ContactPage';
  /** Añade el SoftwareApplication de Uonify con las ofertas de los planes. */
  software?: boolean;
  /** Preguntas y respuestas visibles en la página → FAQPage. Solo si se ven en la página. */
  faq?: readonly SeoQuestion[];
  /** false fuerza noindex aunque la web esté abierta (páginas que no deben salir en buscadores). */
  indexable?: boolean;
  /** Nodos JSON-LD adicionales (Article, HowTo…). */
  schema?: readonly JsonLdNode[];
}
