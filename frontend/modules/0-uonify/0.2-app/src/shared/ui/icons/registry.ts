import { UONY_COMPACT_MARKUP } from './uonyCompact';
import { CORE_ICON_PATHS, type CoreIconName } from './corePaths';
import { EXTRA_ICON_PATHS, type ExtraIconName } from './extraPaths';
import { UONY_MARK_BOX_WIDTH, UONY_MARK_MARKUP } from './uonyMark';

/**
 * Registro de iconos (prototipo: pim/core.js, `icon()` e `icon.add()`).
 * Guarda el interior de cada SVG lucide de 24 × 24; <Icon/> y iconHTML() lo pintan.
 */

/** Nombres de serie (con autocompletado) o cualquiera registrado por un módulo. */
export type IconName = CoreIconName | ExtraIconName | 'uony' | (string & {});

const paths = new Map<string, string>([
  ...Object.entries(CORE_ICON_PATHS),
  ...Object.entries(EXTRA_ICON_PATHS),
  ['uony', UONY_MARK_MARKUP],
]);

/** Ancho de la caja de los iconos que no son cuadrados (alto siempre 24). */
const boxWidths = new Map<string, number>([['uony', UONY_MARK_BOX_WIDTH]]);

/** Ancho del viewBox del icono: 24 salvo la marca de Uony, más ancha que alta. */
export function iconBoxWidth(name: IconName): number {
  return boxWidths.get(name) ?? 24;
}

/** Ancho en píxeles para un alto `size`, con la proporción de su caja. */
export function iconWidth(name: IconName, size: number): number {
  if (name === 'uony' && size <= 28) return 38;
  return Math.round((size * iconBoxWidth(name) / 24) * 100) / 100;
}

/** La marca compacta necesita 28 px; los iconos de trazo mantienen su tamaño. */
export function iconHeight(name: IconName, size: number): number {
  return name === 'uony' && size <= 28 ? 28 : size;
}

export function iconViewBox(name: IconName, size: number): string {
  return name === 'uony' && size <= 28 ? '0 0 38 28' : `0 0 ${iconBoxWidth(name)} 24`;
}

/** Añade o sustituye un icono: `registerIcon('m3d-qr', '<rect …/>')` (equivale a icon.add). */
export function registerIcon(name: string, markup: string): void {
  paths.set(name, markup);
}

/** Si el icono existe en el registro. */
export function hasIcon(name: string): boolean {
  return paths.has(name);
}

/** Interior del SVG; un nombre desconocido pinta «box», como el prototipo. */
export function iconMarkup(name: IconName, size = 24): string {
  if (name === 'uony' && size <= 28) return UONY_COMPACT_MARKUP;
  return paths.get(name) ?? CORE_ICON_PATHS.box;
}

/**
 * El SVG completo como texto, idéntico al `icon(name, size, extraClass)` del
 * prototipo. Solo para puertos que construyen marcado a mano (p. ej. un
 * `dangerouslySetInnerHTML` ya escapado); en JSX usa <Icon/>.
 */
export function iconHTML(name: IconName, size = 16, extraClass = ''): string {
  const className = `pim-icon${name === 'uony' ? ' pim-icon-uony' : ''}${extraClass ? ` ${extraClass}` : ''}`;
  return `<svg class="${className}" width="${iconWidth(name, size)}" height="${iconHeight(name, size)}" viewBox="${iconViewBox(name, size)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconMarkup(name, size)}</svg>`;
}
