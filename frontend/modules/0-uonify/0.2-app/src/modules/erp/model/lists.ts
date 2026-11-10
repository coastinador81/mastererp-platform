import { DEMO_ORDERS, DEMO_PURCHASES, ORDER_STATUSES, type DemoPurchase } from './demoPurchases';
import { ORDERS_ROUTE, PURCHASES_ROUTE } from './paths';

/** Lo que cambia entre las listas de la demo (PurchasesListPreview.jsx, kind purchases u orders). */
export interface DocumentsList {
  route: string;
  title: string;
  /** Frase bajo el título, literal del equipo (PurchasesListPreview.jsx:82). */
  description: string;
  /** Recuento literal del pie de la lista de la demo («6 compras ficticias · Vista local»). */
  countLabel: (count: number) => string;
  searchLabel: string;
  rows: readonly DemoPurchase[];
  statuses: readonly string[];
  /** Etiquetas de las fechas: Compras «Desde/Hasta» (PurchasesFilters.jsx), Órdenes «Fecha desde/hasta». */
  dateLabels: { from: string; to: string };
  /** Órdenes pone la moneda antes que el estado (PurchasesListPreview.jsx:85-91); Compras, después. */
  currencyBeforeStatus: boolean;
  /** Compras sugiere al escribir; Órdenes no (como la demo). */
  suggests: boolean;
  /** Variante de la ficha y de la fila. */
  kind: 'purchases' | 'orders';
  /** Aviso al pie de la lista (solo Órdenes en la demo, PurchasesListPreview.jsx:99). */
  footnote?: string;
}

export const FINANCE_LISTS: Readonly<Record<string, DocumentsList>> = {
  [PURCHASES_ROUTE]: {
    route: PURCHASES_ROUTE,
    title: 'Compras',
    description: 'Consulta las compras y su estado por nodo.',
    countLabel: count => `${count} compras ficticias · Vista local`,
    searchLabel: 'Buscar compra',
    rows: DEMO_PURCHASES,
    statuses: [...new Set(DEMO_PURCHASES.map(row => row.status))],
    dateLabels: { from: 'Desde', to: 'Hasta' },
    currencyBeforeStatus: false,
    suggests: true,
    kind: 'purchases',
  },
  [ORDERS_ROUTE]: {
    route: ORDERS_ROUTE,
    title: 'Órdenes de compra',
    description: 'Consulta las órdenes, sus proveedores y destinos de entrega.',
    countLabel: count => `${count} órdenes ficticias · Vista local`,
    searchLabel: 'Buscar orden',
    rows: DEMO_ORDERS,
    statuses: ORDER_STATUSES,
    dateLabels: { from: 'Fecha desde', to: 'Fecha hasta' },
    currencyBeforeStatus: true,
    suggests: false,
    kind: 'orders',
    footnote: 'Datos DEMO ficticios únicamente para revisar el diseño local. Los filtros actúan sobre estos ejemplos, sin consultas ni persistencia. No representan compras, estados ni saldos reales.',
  },
};

export const listOf = (route: string | null | undefined): DocumentsList | undefined => (route ? FINANCE_LISTS[route] : undefined);
