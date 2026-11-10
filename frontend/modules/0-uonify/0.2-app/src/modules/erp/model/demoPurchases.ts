/**
 * Compras de ejemplo de Finanzas: copia literal de las fixtures y reglas de la demo local
 * del equipo (frontend/modules/2.2-finance/src/local/PurchasesListPreview.jsx:7-26 y su
 * README). No son datos reales ni salen de ninguna API: el servicio ERP las enseña
 * marcadas como «datos de ejemplo» hasta conectar las APIs de Finanzas del equipo.
 */
export type Currency = 'VES' | 'USD' | 'EUR';
export type NodeId = 'a' | 'b' | 'c';

export interface DemoPurchase {
  reference: string;
  /** Fecha ISO (AAAA-MM-DD). */
  date: string;
  nodeId: NodeId;
  node: string;
  supplier: string;
  concept: string;
  currency: Currency;
  total: number;
  status: string;
  /** Documento de origen (en las órdenes, la compra de la que salen; en las sugerencias aprobadas, la sugerencia). */
  source?: string;
  /** Solo en las compras que salen de una sugerencia aprobada (PurchasesPreview.jsx, approveSuggestion). */
  fromSuggestion?: {
    id: string;
    final: { quantity: number; price: number; supplier: string };
    original: { quantity: number; price: number; supplier: string };
    node: { quantity: number; price: number; supplier: string };
    priority: boolean;
    purchasingObservation: string;
    nodeObservation: string;
    nodeReviewedAt: string;
    approvedAt: string;
  };
}

/** Nodos de ejemplo del equipo (UonifyFramePreview y PurchasesPreview usan los mismos). */
export const NODES: ReadonlyArray<{ id: NodeId; name: string }> = [
  { id: 'a', name: 'Nodo de ejemplo A' },
  { id: 'b', name: 'Nodo de ejemplo B' },
  { id: 'c', name: 'Nodo de ejemplo C' },
];

const ROWS: ReadonlyArray<[string, string, NodeId, string, string, Currency, number, string]> = [
  ['001', '2026-11-07', 'a', 'Suministros Horizonte DEMO', 'Material de oficina', 'VES', 18450.50, 'Borrador'],
  ['002', '2026-11-06', 'b', 'Empaques Río Claro DEMO', 'Empaques para despacho', 'VES', 32800, 'Borrador'],
  ['003', '2026-11-05', 'c', 'Tecnología Andina DEMO', 'Mantenimiento de equipos', 'VES', 12500.75, 'Borrador'],
  ['004', '2026-11-04', 'a', 'Limpieza Brisa DEMO', 'Insumos de limpieza', 'VES', 6840, 'Borrador'],
  ['005', '2026-11-03', 'b', 'Servicios Contables Aurora DEMO', 'Servicio administrativo', 'VES', 22100, 'Borrador'],
  ['006', '2026-11-02', 'c', 'Logística Ruta Azul DEMO', 'Material de embalaje', 'VES', 9700.25, 'Borrador'],
  ['007', '2026-11-01', 'a', 'Tecnología Andina DEMO', 'Accesorios informáticos', 'USD', 245.50, 'Borrador'],
  ['008', '2026-10-30', 'b', 'Empaques Río Claro DEMO', 'Cajas de cartón', 'USD', 680, 'Borrador'],
  ['009', '2026-10-29', 'c', 'Suministros Horizonte DEMO', 'Consumibles de oficina', 'USD', 132.75, 'Borrador'],
  ['010', '2026-11-06', 'a', 'Mantenimiento Faro DEMO', 'Repuestos de mantenimiento', 'EUR', 320, 'Borrador'],
  ['011', '2026-11-04', 'b', 'Soluciones Integrales Nube DEMO', 'Servicio técnico', 'EUR', 185.50, 'Borrador'],
  ['012', '2026-10-28', 'c', 'Limpieza Brisa DEMO', 'Utensilios de limpieza', 'EUR', 96.20, 'Borrador'],
];

export const nodeName = (id: NodeId): string => NODES.find(node => node.id === id)?.name ?? 'Nodo de ejemplo';

export const DEMO_PURCHASES: readonly DemoPurchase[] = Object.freeze(
  ROWS.map(([id, date, nodeId, supplier, concept, currency, total, status]) => ({
    reference: `DEMO-COM-${id}`,
    date,
    nodeId,
    node: nodeName(nodeId),
    supplier,
    concept,
    currency,
    total,
    status,
  })),
);

/**
 * Órdenes de compra de la demo (PurchasesListPreview.jsx:21 y :67): las mismas 12 filas con
 * referencia DEMO-OC-…, la compra como origen y los 8 estados ilustrativos en rotación.
 */
export const ORDER_STATUSES: readonly string[] = ['Borrador', 'Pendiente de aprobación', 'En tránsito', 'Completado', 'Recibida parcialmente', 'Aprobada', 'Enviada al proveedor', 'Cancelada'];

export const DEMO_ORDERS: readonly DemoPurchase[] = Object.freeze(
  DEMO_PURCHASES.map((row, index) => ({
    ...row,
    status: ORDER_STATUSES[index % ORDER_STATUSES.length],
    source: row.reference,
    reference: row.reference.replace('COM', 'OC'),
  })),
);

/** «Bs.» para bolívares; el código ISO para el resto, como el equipo. */
export const currencyLabel = (currency: Currency): string => (currency === 'VES' ? 'Bs.' : currency);

/** Monedas de la demo: Bs. por defecto, sin «todas las monedas» ni conversiones (README del equipo). */
export const CURRENCY_OPTIONS: ReadonlyArray<{ value: Currency; label: string }> = [
  { value: 'VES', label: 'Bolívares (Bs.)' },
  { value: 'USD', label: 'Dólares (USD)' },
  { value: 'EUR', label: 'Euros (EUR)' },
];

/** Importe con dos decimales en formato venezolano, como la demo del equipo. */
export const money = (value: number): string =>
  value.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** AAAA-MM-DD → DD/MM/AAAA. */
export const dateLabel = (value: string): string => value.split('-').reverse().join('/');

/** Tono de cada estado (statusTone de la demo del equipo). */
const STATUS_TONE: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
  Completado: 'success',
  Aprobada: 'success',
  'En tránsito': 'info',
  'Enviada al proveedor': 'info',
  'Recibida parcialmente': 'warning',
  'Pendiente de aprobación': 'warning',
  Cancelada: 'danger',
};
export const statusTone = (status: string): string => STATUS_TONE[status] ?? 'neutral';

export interface PurchaseFilters {
  node: '' | NodeId;
  from: string;
  to: string;
  status: string;
  currency: Currency;
  search: string;
}

export const EMPTY_FILTERS: PurchaseFilters = { node: '', from: '', to: '', status: '', currency: 'VES', search: '' };
export const DATE_RANGE_ERROR = 'La fecha hasta debe ser igual o posterior a la fecha desde.';
export const invalidRange = ({ from, to }: Pick<PurchaseFilters, 'from' | 'to'>): boolean => Boolean(from && to && to < from);
/** Filtros distintos de los de partida (la moneda Bs. y la búsqueda no cuentan). */
export const hasActiveFilters = (filters: PurchaseFilters): boolean =>
  Boolean(filters.node || filters.from || filters.to || filters.status || filters.currency !== EMPTY_FILTERS.currency);

const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Mismos filtros que la demo: nodo, fechas, estado, moneda y búsqueda sin acentos. */
export function filterPurchases(items: readonly DemoPurchase[], filters: PurchaseFilters): DemoPurchase[] {
  const needle = fold(filters.search.trim());
  return items.filter(item =>
    (!filters.node || item.nodeId === filters.node)
    && (!filters.from || item.date >= filters.from)
    && (!filters.to || item.date <= filters.to)
    && item.currency === filters.currency
    && (!filters.status || item.status === filters.status)
    && fold([item.reference, item.supplier, item.concept].join(' ')).includes(needle));
}

/**
 * Sugerencias del buscador (PurchasesFilters.jsx de la demo): proveedores, referencias y
 * conceptos de las compras que cumplen los demás filtros y contienen lo escrito; 6 como mucho.
 */
export function suggestPurchases(items: readonly DemoPurchase[], draft: PurchaseFilters): string[] {
  const needle = fold(draft.search.trim());
  if (!needle) return [];
  const rows = items.filter(item =>
    (!draft.node || item.nodeId === draft.node)
    && (!draft.from || item.date >= draft.from)
    && (!draft.to || item.date <= draft.to)
    && item.currency === draft.currency
    && (!draft.status || item.status === draft.status));
  return [...new Set(rows.flatMap(item => [item.supplier, item.reference, item.concept]))]
    .filter(value => fold(value).includes(needle))
    .slice(0, 6);
}

export const findDocument = (items: readonly DemoPurchase[], reference: string | undefined): DemoPurchase | null =>
  reference ? items.find(item => item.reference === reference) ?? null : null;

export const findPurchase = (reference: string | undefined): DemoPurchase | null => findDocument(DEMO_PURCHASES, reference);
