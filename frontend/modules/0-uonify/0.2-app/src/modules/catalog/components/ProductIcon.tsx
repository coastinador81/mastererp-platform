/**
 * Iconos de la ficha y del catálogo con el trazo del prototipo (app-shell.js:
 * productIcon y railIcon). El marcado es propio y fijo, nunca datos de usuario.
 */
const PRODUCT_PATHS = {
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  package: '<path d="M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29,7 12,12 20.71,7"/><path d="M12 22V12"/>',
  price: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  sparkles: '<path d="M9 11a3 3 0 0 1 3-3m-3 3a3 3 0 0 0 3 3m-3-3H5m4 0V7m3 4a3 3 0 0 1 3-3m-3 3a3 3 0 0 0 3 3m-3-3h4m-4 0V7M9 21a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1zM20 16a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1z"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/>',
  wand: '<path d="m15 4 5 5M4 20a1.4 1.4 0 0 1 0-2l12-12a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2L8 22M5 3v4M3 5h4M19 15v4M17 17h4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
} as const;

export type ProductIconName = keyof typeof PRODUCT_PATHS;

export const isProductIconName = (name: unknown): name is ProductIconName => typeof name === 'string' && Object.hasOwn(PRODUCT_PATHS, name);

/** Icono de trazo 1,7 (el tamaño lo pone el CSS del contenedor, como en el prototipo). */
export function ProductIcon({ name }: { name: ProductIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: PRODUCT_PATHS[name] }}
    />
  );
}

const RAIL_PATHS = {
  catalog: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
  threads: '<path d="M4 5h11v8H8l-4 3V5Z"/><path d="M15 9h5v10l-3-2.5h-7V13"/>',
} as const;

export type RailIconName = keyof typeof RAIL_PATHS;

/** Iconos del raíl y de la cabecera del catálogo (el trazo lo pone el CSS). */
export function RailIcon({ name }: { name: RailIconName }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: RAIL_PATHS[name] }} />;
}

/** Flecha del menú de un canal en la cabecera. */
export function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}
