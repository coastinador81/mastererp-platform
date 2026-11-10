/**
 * Resumen de Gestión de compras, literal del equipo
 * (2.2.1-administration/2.2.1.2-gestion-compras/screens/purchases/PurchasesSummary.jsx):
 * indicadores sin cifras, dos tablas vacías y filtros de ámbito. Los iconos son los suyos;
 * los colores de fondo de cada indicador no se copian (el manual manda en lo visual).
 */
export type SummaryIcon = 'liquidity' | 'payable' | 'reserves' | 'credit' | 'returns' | 'discounts' | 'suppliers';

export const SUMMARY_ICON_PATHS: Record<SummaryIcon, string> = {
  liquidity: '<path d="M4 7h15v13H4V7Zm0 0V4h12v3m0 5h5v5h-5v-5Z"/><circle cx="17.5" cy="14.5" r=".5"/>',
  payable: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3"/>',
  reserves: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="M12 8v8m-4-4h8"/>',
  credit: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-8 5h5"/>',
  returns: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-3"/>',
  discounts: '<path d="m3 12 9-9h8v8l-9 9-8-8Z"/><circle cx="16" cy="7" r="1"/><path d="m9 11 5 5m0-5-5 5"/>',
  suppliers: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/>',
};

export const INDICATORS: ReadonlyArray<{ name: string; icon: SummaryIcon; description: string }> = [
  { name: 'Liquidez disponible', icon: 'liquidity', description: 'Fondos disponibles para compras.' },
  { name: 'Cuentas por pagar', icon: 'payable', description: 'Obligaciones pendientes con proveedores.' },
  { name: 'Reservas financieras', icon: 'reserves', description: 'Fondos reservados para compromisos.' },
  { name: 'Notas de crédito', icon: 'credit', description: 'Créditos de proveedores por consultar.' },
  { name: 'Devoluciones', icon: 'returns', description: 'Devoluciones vinculadas a compras.' },
  { name: 'Descuentos', icon: 'discounts', description: 'Descuentos asociados a proveedores.' },
];

export interface SummaryTable {
  id: string;
  title: string;
  description: string;
  icon: SummaryIcon;
  columns: string[];
  emptyIcon: SummaryIcon;
  emptyTitle: string;
  emptyText: string;
}

export const SUMMARY_TABLES: readonly SummaryTable[] = [
  {
    id: 'payable',
    title: 'Cuentas por pagar a proveedores',
    description: 'Consulta los compromisos pendientes y sus vencimientos.',
    icon: 'suppliers',
    columns: ['Proveedor', 'Por pagar', 'Vencido', 'Próximo vencimiento', 'Moneda'],
    emptyIcon: 'payable',
    emptyTitle: 'Sin información de proveedores',
    emptyText: 'Aquí verás las cuentas por pagar y sus próximos vencimientos.',
  },
  {
    id: 'reserves',
    title: 'Reservas financieras',
    description: 'Fondos destinados a compromisos de compra.',
    icon: 'reserves',
    columns: ['Concepto', 'Importe reservado', 'Moneda', 'Estado'],
    emptyIcon: 'reserves',
    emptyTitle: 'Sin información de reservas',
    emptyText: 'Aquí podrás consultar los fondos reservados.',
  },
];

/** «12/11/2026 — 15/11/2026», «Desde …», «Hasta …» o «Todas las fechas», como la demo. */
export function datesLabel(from: string, to: string): string {
  const show = (value: string) => value.split('-').reverse().join('/');
  if (from && to) return `${show(from)} — ${show(to)}`;
  if (from) return `Desde ${show(from)}`;
  if (to) return `Hasta ${show(to)}`;
  return 'Todas las fechas';
}
