#!/usr/bin/env node
/** Parchea view-portada del index de home-v22: launcher compartido y sin panel Preferencias en la portada. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TARGET = path.join(ROOT, 'web/home-v22-propuesta/index.html');
const LAUNCHER_SRC = path.resolve(ROOT, '../../../shared/module-launcher/module-launcher.mjs');
const LAUNCHER_DST = path.join(ROOT, 'web/home-v22-propuesta/module-launcher.mjs');

const input = process.argv[2];
if (!input || !fs.existsSync(input)) {
  console.error('Uso: node patch-home-v22-index.mjs <ruta-al-index.html-descargado>');
  process.exit(2);
}

let html = fs.readFileSync(input, 'utf8');
const start = html.indexOf('<template id="view-portada">');
const end = html.indexOf('</template>', start);
if (start < 0 || end < 0) fail('no encuentro template view-portada');

let portada = html.slice(start, end);
const toolsRe = /\s*<button type="button" class="tools-trigger"[\s\S]*?<\/section>\s*(?=\s*<\/header>)/;
if (!toolsRe.test(portada)) fail('no encuentro tools-panel en view-portada');
portada = portada.replace(toolsRe, '\n      <mastererp-module-launcher current-app="uonify"></mastererp-module-launcher>\n    ');

portada = portada.replace(
  /<nav aria-label="Legal y preferencias">[\s\S]*?<\/nav>\s*/,
  '<nav aria-label="Legal"><a href="privacidad.html">Privacidad</a><a href="terminos.html">Condiciones</a></nav>\n    ',
);
portada = portada.replace(/\s*<dialog id="preferences-dialog"[\s\S]*?<\/dialog>\s*/, '\n');

html = html.slice(0, start) + portada + html.slice(end);

const espStart = html.indexOf('<template id="view-espacio">');
const espEnd = espStart >= 0 ? html.indexOf('</template>', espStart) : -1;
if (espStart >= 0 && espEnd >= 0) {
  let espacio = html.slice(espStart, espEnd);
  const servicesRe = /<button class="services-trigger"[\s\S]*?<\/section>\s*(?=\s*<\/header>)/;
  if (servicesRe.test(espacio)) {
    espacio = espacio.replace(servicesRe, '<mastererp-module-launcher current-app="uonify"></mastererp-module-launcher>\n        ');
    html = html.slice(0, espStart) + espacio + html.slice(espEnd);
  }
}

const script = '<script type="module" src="module-launcher.mjs"></script>';
if (!html.includes('module-launcher.mjs')) {
  if (!html.includes(script)) html = html.replace('</head>', `  ${script}\n</head>`);
}

fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, html);
fs.copyFileSync(LAUNCHER_SRC, LAUNCHER_DST);
console.log(`OK: ${TARGET}\n     ${LAUNCHER_DST}`);

function fail(message) {
  console.error('ERROR: ' + message);
  process.exit(2);
}
