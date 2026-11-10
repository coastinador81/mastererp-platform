/**
 * Menú de Finanzas → Administración, literal del equipo (frontend/modules/2.2-finance/
 * src/FinanceNavigation.jsx: grupos, apartados, rutas, orden e iconos; en Gestión de
 * compras, el orden del modo diseño, con Resumen y Sugerencias de compras).
 *
 * Estado de cada apartado en la app de Uonify:
 *   'uonify'     ya está aquí, con los datos de ejemplo del equipo
 *   'equipo'     el equipo lo tiene desarrollado y llegará aquí en los próximos pasos
 *   'pendiente'  sin vista del equipo todavía: se abre con su estado vacío (EmptyApartado)
 */
export type FinanceIconName = 'summary' | 'clients' | 'quote' | 'sales' | 'document' | 'supplier' | 'order' | 'invoice';
export type ApartadoStatus = 'uonify' | 'equipo' | 'pendiente';

export interface Apartado {
  label: string;
  /** Ruta del equipo (vista=…); la de los pendientes es propia de Uonify. */
  route?: string;
  icon: FinanceIconName;
  status: ApartadoStatus;
}

export interface FinanceGroup {
  number: string;
  name: string;
  icon: FinanceIconName;
  items: Apartado[];
}

/** Ruta de un apartado sin vista del equipo: «Caja chica» → caja-chica. */
export const slugOf = (label: string): string =>
  label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const pendingItem = (label: string): Apartado => ({ label, route: slugOf(label), icon: 'document', status: 'pendiente' });

export const FINANCE_MENU: readonly FinanceGroup[] = [
  {
    number: '2.2.1.1',
    name: 'Gestión comercial',
    icon: 'sales',
    items: [
      { label: 'Clientes', route: 'clientes', icon: 'clients', status: 'equipo' },
      { label: 'Cotizaciones', route: 'cotizaciones', icon: 'quote', status: 'pendiente' },
      { label: 'Ventas', route: 'ventas', icon: 'sales', status: 'equipo' },
      { label: 'Facturación', route: 'facturacion', icon: 'document', status: 'pendiente' },
    ],
  },
  {
    number: '2.2.1.2',
    name: 'Gestión de compras',
    icon: 'order',
    items: [
      { label: 'Resumen', route: 'resumen-compras', icon: 'summary', status: 'uonify' },
      { label: 'Proveedores', route: 'proveedores', icon: 'supplier', status: 'equipo' },
      { label: 'Compras', route: 'solicitudes-compra', icon: 'document', status: 'uonify' },
      { label: 'Sugerencias de compras', route: 'sugerencias-compras', icon: 'summary', status: 'uonify' },
      { label: 'Órdenes de compra', route: 'ordenes-compra', icon: 'order', status: 'uonify' },
      { label: 'Facturas de proveedores', route: 'facturas-proveedores', icon: 'invoice', status: 'equipo' },
    ],
  },
  {
    number: '2.2.1.3',
    name: 'Cartera y obligaciones',
    icon: 'invoice',
    items: [
      { label: 'Cuentas por cobrar', route: 'cuentas-por-cobrar', icon: 'document', status: 'pendiente' },
      { label: 'Cuentas por pagar', route: 'cuentas-por-pagar', icon: 'document', status: 'pendiente' },
    ],
  },
  {
    number: '2.2.1.4',
    name: 'Tesorería',
    icon: 'summary',
    items: ['Cobros', 'Pagos', 'Caja', 'Bancos', 'Transferencias', 'Conciliación'].map(pendingItem),
  },
  {
    number: '2.2.1.5',
    name: 'Gastos y fondos menores',
    icon: 'document',
    items: ['Gastos operativos', 'Caja chica', 'Anticipos y rendiciones'].map(pendingItem),
  },
];

/** Trazos de FinanceIcon.jsx del equipo, para pintarlos con los iconos de línea del raíl. */
export const FINANCE_ICON_PATHS: Record<FinanceIconName, string> = {
  summary: '<path d="M4 20V11m5 9V6m5 14V3m5 17V9"/>',
  clients: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
  quote: '<path d="m3 12 9-9h8v8l-9 9-8-8Z"/><circle cx="16" cy="7" r="1"/>',
  sales: '<path d="M3 4h2l2 12h12l2-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  document: '<path d="M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6"/>',
  supplier: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  order: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8m-9 5v9"/>',
  invoice: '<path d="M7 7H3v14h12v-4M8 3h9l4 4v10H8V3Zm9 0v5h4M11 11h6m-6 3h6"/>',
};

export const findApartado = (route: string | undefined): { group: FinanceGroup; item: Apartado } | null => {
  if (!route) return null;
  for (const group of FINANCE_MENU) {
    const item = group.items.find(entry => entry.route === route);
    if (item) return { group, item };
  }
  return null;
};
