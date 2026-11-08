/**
 * Utilidades puras sin interfaz, compartidas por todos los módulos.
 * Origen: `util` de pim/core.js del prototipo.
 */
export { formatBytes, escapeHTML } from './format';
export { sleep, debounce, type Debounced } from './timing';
export { uid, clamp } from './id';
export { readFileAsDataURL, readFileAsText, download } from './files';
