import { USE_MOCKS } from '@/shared/api/config';
import type { FinanceCollection } from '../api/finance';
import type { Messages } from '../hooks/useRealData';

/**
 * Apartados de Finanzas con datos reales de la API del equipo (/v1/administration/*), con los
 * textos literales de sus pantallas: Purchases.jsx y PurchaseForm.jsx (compras), Parties.jsx,
 * SupplierDirectory.jsx y CustomerOverview.jsx (terceros) y Sales.jsx y SaleDetail.jsx (ventas).
 * El permiso es el de su menú (FinanceNavigation.jsx:19): solo enseña u oculta; la API decide.
 */
export type RealKind = 'purchases' | 'parties' | 'sales';

export interface RealApartado {
  route: string;
  kind: RealKind;
  collection: FinanceCollection;
  title: string;
  /** Plural en minúsculas de sus textos («No hay proveedores registrados…»). */
  plural: string;
  permission: string;
  /** Frase bajo el título, solo si la pantalla del equipo la tiene. */
  description?: string;
  messages: Messages;
  loading: string;
  empty: string;
}

const PURCHASE_MESSAGES: Messages = {
  401: 'Tu sesión ha caducado.',
  403: 'No tienes acceso a esta operación.',
  404: 'El documento no está disponible en esta empresa.',
  503: 'El servicio no está disponible. Puedes reintentar.',
  fallback: 'El servicio no está disponible. Puedes reintentar.',
};

const PARTY_MESSAGES: Messages = {
  400: 'Revisa los campos de la solicitud.',
  401: 'Tu sesión ha caducado.',
  403: 'Acceso denegado.',
  404: 'El tercero no está disponible en esta empresa.',
  503: 'El servicio no está disponible. Puedes volver a intentarlo.',
  fallback: 'No se pudo cargar. Vuelve a intentarlo.',
};

const SALE_MESSAGES: Messages = {
  400: 'No se pudo consultar esta página. Vuelve al listado para intentarlo.',
  401: 'Tu sesión ha caducado. Vuelve a acceder.',
  403: 'No tienes permiso para consultar las ventas de esta empresa.',
  404: 'Esta venta no está disponible en la empresa activa.',
  503: 'No se pudieron cargar las ventas. Puedes volver a intentarlo.',
  fallback: 'No se pudieron cargar las ventas. Puedes volver a intentarlo.',
};

const purchase = (route: string, collection: FinanceCollection, title: string): RealApartado => ({
  route,
  kind: 'purchases',
  collection,
  title,
  plural: title.toLowerCase(),
  permission: 'administration.purchases.read',
  messages: PURCHASE_MESSAGES,
  loading: `Cargando ${title.toLowerCase()}…`,
  empty: `No hay ${title.toLowerCase()} en esta empresa.`,
});

const party = (route: 'clientes' | 'proveedores', title: string, description?: string): RealApartado => ({
  route,
  kind: 'parties',
  collection: route,
  title,
  plural: route,
  permission: 'administration.parties.read',
  description,
  messages: PARTY_MESSAGES,
  loading: `Cargando ${route}…`,
  empty: `No hay ${route} registrados en esta empresa.`,
});

export const REAL_APARTADOS: Readonly<Record<string, RealApartado>> = {
  clientes: party('clientes', 'Clientes'),
  ventas: {
    route: 'ventas',
    kind: 'sales',
    collection: 'ventas',
    title: 'Ventas',
    plural: 'ventas',
    permission: 'administration.read',
    description: 'Consulta las ventas originadas en eCommerce.',
    messages: SALE_MESSAGES,
    loading: 'Cargando ventas…',
    empty: 'Todavía no hay ventas registradas en esta empresa.',
  },
  proveedores: party('proveedores', 'Proveedores', 'Gestiona la información de tus proveedores.'),
  'solicitudes-compra': purchase('solicitudes-compra', 'compras/solicitudes', 'Compras'),
  'ordenes-compra': purchase('ordenes-compra', 'compras/ordenes', 'Órdenes de compra'),
  'facturas-proveedores': purchase('facturas-proveedores', 'compras/facturas', 'Facturas de proveedores'),
};

export const realApartado = (route: string | null | undefined): RealApartado | undefined => (route ? REAL_APARTADOS[route] : undefined);

/** Importe con separadores de miles, como salesFormat.mjs del equipo (cadenas decimales, sin redondeo). */
export function amount(value: string | null | undefined, minimum = 2): string {
  if (value === null || value === undefined) return '—';
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return '—';
  const fraction = (match[3] ?? '').replace(/0+$/, '').padEnd(minimum, '0');
  return match[1] + new Intl.NumberFormat('es-VE').format(BigInt(match[2])) + (fraction ? `,${fraction}` : '');
}

/** Fecha dd/mm/aaaa (salesFormat.mjs); «—» si no hay. */
export function date(value: string | null | undefined): string {
  const parts = String(value ?? '').slice(0, 10).split('-');
  return parts.length === 3 ? parts.reverse().join('/') : '—';
}

export const saleState = (value: string | null | undefined) => (value === 'ACTIVE' ? 'Confirmada' : value === 'CANCELLED' ? 'Anulada' : value || '—');
export const saleOrigin = (value: string | null | undefined) => (value === 'ecommerce' ? 'eCommerce' : value || '—');

/** Origen de los datos que se enseña en listas y fichas: en la vista local, la simulación. */
export const SOURCE_LABEL = USE_MOCKS ? 'Simulación' : 'Datos reales';
