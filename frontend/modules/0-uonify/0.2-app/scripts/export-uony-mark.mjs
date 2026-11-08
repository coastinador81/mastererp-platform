/** Regenera los SVG de distribución desde el único maestro geométrico de Uony. */
import { readFile, writeFile } from 'node:fs/promises';
import { UONY_COMPACT_PATH } from '../src/shared/ui/icons/uonyCompact.ts';
import {
  UONY_MARK_PATH as path, UONY_MARK_GRADIENT as g, UONY_MARK_TRANSFORM as transform,
} from '../src/shared/ui/icons/uonyMark.ts';

const asset = name => new URL(`../public/assets/brands/${name}`, import.meta.url);
const stops = g.stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('');
const gradient = `<linearGradient id="uony-mark-gradient" gradientUnits="userSpaceOnUse" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}">${stops}</linearGradient>`;
await writeFile(asset('uonify-isotipo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 24" role="img" aria-label="Uony · Uonify" shape-rendering="geometricPrecision">\n<defs>${gradient}</defs>\n<g transform="${transform}"><path fill="url(#uony-mark-gradient)" d="${path}"/></g>\n</svg>\n`);

// La misma ON en los logotipos completos, manteniendo las otras letras y su caja.
for (const name of ['uonify-wordmark.svg', 'uonify-wordmark-mono.svg']) {
  let svg = await readFile(asset(name), 'utf8');
  const fill = name.includes('-mono') ? '#14171E' : 'url(#uony-mark-gradient)';
  svg = svg.replace(/<g data-uony-mark="true">.*?<\/g>|<path fill="[^"]*" d="M301\.209[^\"]*"\/>/s,
    `<g data-uony-mark="true"><path transform="translate(167.5 .25)" fill="${fill}" d="${path}"/></g>`);
  if (!name.includes('-mono')) {
    svg = svg.replace(/<linearGradient id="(?:g1|uony-mark-gradient)"[^>]*>.*?<\/linearGradient>/s, gradient);
  }
  await writeFile(asset(name), svg);
}

// Variante óptica para controles: publicar siempre a 38 × 28 px o más.
await writeFile(asset('uonify-isotipo-control.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="28" viewBox="0 0 38 28" role="img" aria-label="Uony · Uonify">
<defs><linearGradient id="uony-compact-gradient" gradientUnits="userSpaceOnUse" x1="37" y1="3" x2="1" y2="25">${stops}</linearGradient></defs>
<path fill="url(#uony-compact-gradient)" d="${UONY_COMPACT_PATH}"/>
</svg>
`);
