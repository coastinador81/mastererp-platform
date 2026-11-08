// Prerender de la web pública: convierte cada ruta pública (y las del centro de ayuda)
// en HTML estático dentro de dist/, para que buscadores y buscadores de IA lean el
// contenido sin ejecutar JavaScript. Escribe también robots.txt y sitemap.xml.
//
// Se ejecuta solo después de `npm run build` (script «postbuild»), o a mano:
//   npm run prerender      (necesita dist/ de un `vite build` previo)
//
// Hasta el lanzamiento todo sale con noindex y robots.txt «Disallow: /».
// En el lanzamiento: VITE_INDEXING=true npm run build   (ver src/modules/public-site/README.md)
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const SSR_ENTRY = join(ROOT, 'node_modules/.cache/uonify-prerender/entry-server.js');
/** Hojas de las vistas, con su huella en el nombre (caché larga y compartida entre páginas). */
const STYLE_DIR = 'assets/prerender';

async function write(relative, content) {
  const file = join(DIST, relative);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function writeSheets(sheets) {
  const hrefs = [];
  for (const css of sheets) {
    const hash = createHash('sha256').update(css).digest('hex').slice(0, 10);
    const relative = `${STYLE_DIR}/${hash}.css`;
    await write(relative, css);
    hrefs.push(`/${relative}`);
  }
  return hrefs;
}

async function main() {
  const ssr = await import(pathToFileURL(SSR_ENTRY).href);
  // Plantilla: el index.html de `vite build`; si ya se prerenderizó, su copia limpia spa.html.
  const built = await readFile(join(DIST, 'index.html'), 'utf8');
  const template = built.includes('data-prerendered=') ? await readFile(join(DIST, 'spa.html'), 'utf8') : built;
  const env = ssr.SEO_ENV;
  await rm(join(DIST, STYLE_DIR), { recursive: true, force: true });

  // La aplicación sin prerender (noindex): respaldo del alojamiento para /espacio, /admin…
  await write('spa.html', template);

  const done = [];
  for (const path of ssr.PRERENDER_PATHS) {
    const rendered = await ssr.renderPage(path);
    if (rendered.status !== 'ok') {
      console.warn(`  · ${path}: sin prerender (${rendered.status}${rendered.location ? ` → ${rendered.location}` : ''})`);
      continue;
    }
    const hrefs = await writeSheets(rendered.sheets);
    await write(ssr.outputFileFor(path), ssr.buildDocument(template, rendered, env, hrefs));
    done.push(path);
    console.log(`  ✓ ${path}  «${rendered.page.title}»`);
  }
  if (!done.length) throw new Error('No se ha prerenderizado ninguna ruta.');

  await write('robots.txt', ssr.buildRobotsTxt(env));
  await write('sitemap.xml', ssr.buildSitemapXml(done, env, new Date()));
  const state = env.indexing ? 'INDEXABLE (lanzamiento)' : 'noindex y robots «Disallow: /» (antes del lanzamiento)';
  console.log(`Prerender: ${done.length} páginas en dist/ · ${env.siteUrl} · ${state}`);
}

main().catch(error => {
  console.error('Prerender fallido:', error);
  process.exit(1);
});
