// Variables de compilación de la web pública (SEO). Se suman a las de src/vite-env.d.ts.
interface ImportMetaEnv {
  /** Origen público de la web, sin barra final. Por defecto «https://uonify.com». */
  readonly VITE_SITE_URL?: string;
  /** «true» solo en el lanzamiento: quita el noindex y abre robots.txt a los buscadores. */
  readonly VITE_INDEXING?: string;
}
