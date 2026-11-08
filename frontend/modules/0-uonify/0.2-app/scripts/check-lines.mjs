// Comprueba la regla de la casa: ningún archivo de src supera 500 líneas
// (TypeScript, TSX y CSS). Uso: npm run check:lines
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const MAX = 500;
const ROOT = new URL('../src', import.meta.url).pathname;
const EXT = /\.(ts|tsx|css)$/;
const offenders = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (EXT.test(name)) {
      const lines = readFileSync(path, 'utf8').split('\n').length;
      if (lines > MAX) offenders.push(`${relative(ROOT, path)} (${lines})`);
    }
  }
}

walk(ROOT);
if (offenders.length) {
  console.error(`Archivos con más de ${MAX} líneas:\n  ${offenders.join('\n  ')}`);
  process.exit(1);
}
console.log(`OK: ningún archivo de src supera ${MAX} líneas.`);
