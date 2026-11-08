/**
 * Imágenes reales de public/assets que devuelve la simulación: fotos y renders
 * del producto de ejemplo «Make It Possible» by Uonify (juego de 25 piezas).
 * Medidas y pesos medidos en cada archivo.
 */

export interface AssetImage {
  path: string;
  width: number;
  height: number;
  size: number;
  type: string;
}

const webp = 'image/webp';
const jpeg = 'image/jpeg';

/** Lo que «encuentra» el scraper en una página de producto. */
export const SCRAPE_POOL: AssetImage[] = [
  { path: '/assets/galeria-v57/01-hero.webp', width: 3000, height: 3000, size: 327162, type: webp },
  { path: '/assets/galeria-v57/02-la-partida.webp', width: 1254, height: 1254, size: 332230, type: webp },
  { path: '/assets/galeria-v57/03-apila.webp', width: 3000, height: 3000, size: 243246, type: webp },
  { path: '/assets/galeria-v57/04-transforma.webp', width: 3000, height: 3000, size: 253326, type: webp },
  { path: '/assets/galeria-v57/05-piezas.webp', width: 3000, height: 3000, size: 178966, type: webp },
  { path: '/assets/galeria-v57/06-detalles.webp', width: 3000, height: 3000, size: 160068, type: webp },
  { path: '/assets/galeria-v57/07-crea-en-compania.webp', width: 1254, height: 1254, size: 457284, type: webp },
  { path: '/assets/jenga/ficha/UON-KIT-01.PT02.jpg', width: 1600, height: 1600, size: 195334, type: jpeg },
];

/** Escenas de estilo de vida que «genera» Uony. */
export const AI_POOL: AssetImage[] = [
  { path: '/assets/jenga/ficha/lifestyle-la-partida.jpg', width: 1254, height: 1254, size: 394533, type: jpeg },
  { path: '/assets/jenga/ficha/lifestyle-crea-en-compania.jpg', width: 1254, height: 1254, size: 496439, type: jpeg },
  { path: '/assets/jenga/ficha/lifestyle-tu-turno.jpg', width: 1672, height: 941, size: 422204, type: jpeg },
  { path: '/assets/galeria-v57/02-la-partida.webp', width: 1254, height: 1254, size: 332230, type: webp },
  { path: '/assets/galeria-v57/07-crea-en-compania.webp', width: 1254, height: 1254, size: 457284, type: webp },
  { path: '/assets/galeria-v57/01-hero.webp', width: 3000, height: 3000, size: 327162, type: webp },
];

/** Galería del catálogo de Amazon (variantes MAIN / PT01…), como la del producto de ejemplo. */
export const CATALOG_VARIANTS: Array<AssetImage & { variant: string }> = [
  { variant: 'MAIN', path: '/assets/jenga/ficha/UON-KIT-01.MAIN.jpg', width: 2000, height: 2000, size: 351930, type: jpeg },
  { variant: 'PT01', path: '/assets/jenga/ficha/UON-KIT-01.PT01.jpg', width: 1934, height: 1266, size: 507199, type: jpeg },
  { variant: 'PT02', path: '/assets/jenga/ficha/UON-KIT-01.PT02.jpg', width: 1600, height: 1600, size: 195334, type: jpeg },
  { variant: 'PT03', path: '/assets/jenga/ficha/UON-KIT-01.PT03.jpg', width: 2000, height: 2000, size: 293160, type: jpeg },
  { variant: 'PT04', path: '/assets/jenga/ficha/UON-KIT-01.PT04.jpg', width: 2000, height: 2000, size: 310280, type: jpeg },
  { variant: 'PT05', path: '/assets/jenga/ficha/UON-KIT-01.PT05.jpg', width: 2000, height: 2000, size: 264573, type: jpeg },
];

/** Hash corto y estable de un texto (elige qué imágenes «hay» en cada URL o ASIN). */
export function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
}

/** `count` elementos seguidos de `pool` a partir de `start` (da la vuelta). */
export function rotate<T>(pool: T[], start: number, count: number): T[] {
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[(start + i) % pool.length]);
}

/** Nombre de archivo a partir del nombre del producto. */
export function slugOf(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 48) || 'producto';
}
