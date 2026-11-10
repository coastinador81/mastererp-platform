import { record } from '@/shared/mocks/db';
import type { Party, PurchaseDocument, Sale } from '../api/finance';
import type { LiveStatus } from '../api/live';

/**
 * Simulación local de la conexión con el ERP (solo VITE_USE_MOCKS): la misma forma que
 * devuelve el servidor de Uonify (mastererp_store.public_status y mastererp_refs), con datos
 * marcados DEMO. Sirve para revisar las pantallas sin una cuenta real; nunca llega a dev.uonify.com.
 */
interface DemoConnection {
  connected: boolean;
  tenantId: string | null;
  companyId: string | null;
}

export const demoConnection = record<DemoConnection>('erp-demo-connection', () => ({ connected: false, tenantId: null, companyId: null }));

const SPACE = { id: 'espacio-demo', name: 'Espacio DEMO' };
const COMPANY = { id: 'empresa-demo', name: 'Empresa DEMO' };

export function demoStatus(): LiveStatus {
  const state = demoConnection.get();
  if (!state.connected) return { status: 'disconnected' };
  return {
    status: 'connected',
    email: 'persona@example.test',
    spaces: [SPACE],
    tenantId: state.tenantId,
    companies: state.tenantId ? [COMPANY] : [],
    companyId: state.companyId,
    modules: ['erp.finance'],
    permissions: ['administration.parties.read', 'administration.purchases.read', 'administration.read'],
  };
}

/** «Conectar MasterERP» en la vista local: conecta la simulación con su único espacio y empresa. */
export function connectDemo(): void {
  demoConnection.set({ connected: true, tenantId: SPACE.id, companyId: COMPANY.id });
}

const purchase = (ref: string, numero: string | null, fecha: string, proveedor: string, moneda: string, lineas: Array<[string, string, string, string]>): PurchaseDocument => {
  const total = lineas.reduce((sum, line) => sum + Number(line[3]), 0).toFixed(2);
  return {
    ref, numero, serie: null, fecha, proveedor, moneda, total, estado: 'borrador', version: 1, editable: true,
    moneda_base: 'VES', total_base: moneda === 'VES' ? total : (Number(total) * 36.5).toFixed(2), tipo_cambio: moneda === 'VES' ? '1' : '36.5',
    cambio_fecha: fecha, cambio_fuente: moneda === 'VES' ? 'Sin conversión' : 'Tasa de ejemplo DEMO',
    lineas: lineas.map(([descripcion, cantidad, precio_unitario, line]) => ({ descripcion, cantidad, precio_unitario, total: line })),
  };
};

const party = (ref: string, nombre: string, roles: string[], origen: string | null): Party => ({
  ref, codigo: ref, nombre, version: 2, origen, roles,
  datos_generales: {
    nombre_comercial: nombre.replace(' DEMO', ''), tipo_persona: 'juridica', pais_fiscal: 'VE', tipo_identificacion: 'RIF',
    numero_identificacion: 'J-00000000-0', email: 'administracion@example.invalid', telefono: '+58 000 0000000', ciudad: 'Ciudad de ejemplo',
    observaciones: 'Ficha de ejemplo para revisar la pantalla.',
  },
  contactos: [{ nombre: 'Contacto DEMO', cargo: 'Administración', email: 'contacto@example.invalid', principal: true }],
  condiciones: { moneda: 'VES', condicion_pago: 'credito', medio_pago: 'transferencia', plazo_pago_dias: '30', descuento_pronto_pago: '2', plazo_pronto_pago_dias: '10' },
});

const sale = (ref: string, fecha: string, estado: string, cliente: [string, string], pedido: string, lineas: Array<[string, string, string]>): Sale => {
  const rows = lineas.map(([descripcion, cantidad, precio], index) => {
    const subtotal = (Number(cantidad) * Number(precio)).toFixed(2);
    return { posicion: index + 1, descripcion, cantidad, precio_unitario: precio, subtotal, descuento: '0', recargo: '0', tributos: '0', total: subtotal };
  });
  const total = rows.reduce((sum, row) => sum + Number(row.total), 0).toFixed(2);
  return {
    ref, numero: ref, fecha, estado, origen: 'ecommerce', cliente: { codigo: cliente[0], nombre: cliente[1] }, pedido: { numero: pedido },
    moneda: 'VES', decimales: 2, total, moneda_base: 'VES', decimales_base: 2, total_base: total, lineas: rows,
  };
};

export const DEMO_RECORDS: Record<string, Array<PurchaseDocument | Party | Sale>> = {
  compras: [
    purchase('DEMO-SC-0001', 'DEMO-SC-0001', '2026-11-05', 'Suministros Horizonte DEMO', 'VES', [['Papel bond carta (DEMO)', '40', '312.5', '12500.00'], ['Tóner de impresora (DEMO)', '2', '2975.25', '5950.50']]),
    purchase('DEMO-SC-0002', 'DEMO-SC-0002', '2026-11-07', 'Servicios Técnicos Andinos DEMO', 'USD', [['Mantenimiento preventivo (DEMO)', '1', '640', '640.00']]),
    purchase('B-DEMO1', null, '2026-11-08', 'Distribuidora Central DEMO', 'VES', [['Material de limpieza (DEMO)', '10', '230', '2300.00']]),
  ],
  ordenes: [
    purchase('DEMO-OC-0101', 'DEMO-OC-0101', '2026-11-06', 'Suministros Horizonte DEMO', 'VES', [['Papel bond carta (DEMO)', '40', '312.5', '12500.00']]),
    purchase('DEMO-OC-0102', 'DEMO-OC-0102', '2026-11-08', 'Servicios Técnicos Andinos DEMO', 'USD', [['Revisión de equipos (DEMO)', '2', '180', '360.00']]),
  ],
  facturas: [
    purchase('DEMO-FP-0501', 'DEMO-FP-0501', '2026-11-08', 'Suministros Horizonte DEMO', 'VES', [['Papel bond carta (DEMO)', '40', '312.5', '12500.00']]),
  ],
  proveedores: [
    party('PRV-DEMO-01', 'Suministros Horizonte DEMO', ['proveedor'], null),
    party('PRV-DEMO-02', 'Servicios Técnicos Andinos DEMO', ['proveedor', 'cliente'], null),
  ],
  clientes: [
    party('CLI-DEMO-01', 'Cliente Mayorista DEMO', ['cliente'], 'ecommerce'),
    party('PRV-DEMO-02', 'Servicios Técnicos Andinos DEMO', ['proveedor', 'cliente'], null),
  ],
  ventas: [
    sale('DEMO-VT-1001', '2026-11-06', 'ACTIVE', ['CLI-DEMO-01', 'Cliente Mayorista DEMO'], 'DEMO-PED-2001', [['Caja de producto A (DEMO)', '4', '1300']]),
    sale('DEMO-VT-1002', '2026-11-07', 'CANCELLED', ['CLI-DEMO-01', 'Cliente Mayorista DEMO'], 'DEMO-PED-2002', [['Producto B (DEMO)', '1', '850']]),
  ],
};
