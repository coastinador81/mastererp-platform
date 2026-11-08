/** Rutas públicas del centro de ayuda. */
export const HELP_BASE = '/ayuda';

/** Dominio de producción, para las URL canónicas y los datos estructurados. */
export const SITE_ORIGIN = 'https://uonify.com';

export function articlePath(slug: string): string {
  return `${HELP_BASE}/${slug}`;
}

/** Ancla de una colección en la portada del centro de ayuda. */
export function collectionAnchor(collectionId: string): string {
  return `coleccion-${collectionId}`;
}

export function collectionPath(collectionId: string): string {
  return `${HELP_BASE}#${collectionAnchor(collectionId)}`;
}

/** Búsqueda con resultados en la portada: /ayuda?q=… */
export function searchPath(query: string): string {
  const q = query.trim();
  return q ? `${HELP_BASE}?q=${encodeURIComponent(q)}` : HELP_BASE;
}

export const CONTACT_EMAIL = 'hola@uonify.com';
