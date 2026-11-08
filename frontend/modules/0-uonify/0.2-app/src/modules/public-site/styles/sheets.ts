import frameCss from './frame.css?inline';
import clientPreviewCss from './client-preview.css?inline';

/**
 * Añade el marco común delante de las hojas de una vista pública.
 * Cada vista importa sus hojas con `?inline` (así viajan en el trozo de su ruta)
 * y useViewStyles las inyecta solo mientras está montada.
 */
export function viewSheets(...sheets: string[]): readonly string[] {
  return Object.freeze([frameCss, ...sheets.slice(0, -1), `${sheets.at(-1) || ''}\n${clientPreviewCss}`]);
}
