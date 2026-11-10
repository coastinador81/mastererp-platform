/**
 * Trazos de los iconos del raíl y del panel: los mismos que el catálogo de Producto
 * (catalog/components/ProductIcon.tsx: panel e hilos), para que el raíl sea idéntico.
 */
const RAIL_PATHS = {
  panel: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
  threads: '<path d="M4 5h11v8H8l-4 3V5Z"/><path d="M15 9h5v10l-3-2.5h-7V13"/>',
} as const;

export type RailIconName = keyof typeof RAIL_PATHS;

export function RailIcon({ name }: { name: RailIconName }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" dangerouslySetInnerHTML={{ __html: RAIL_PATHS[name] }} />;
}
