/**
 * Datos de Finanzas tal como los entrega el servidor de Uonify: los campos de negocio de la
 * API del equipo (/v1/administration/*), sin ids internos (cada fila lleva su referencia
 * opaca, `ref`). Contratos del equipo: 037_purchase_drafts.sql, 045_customer_legacy_contact_
 * projection.sql y 048_sales_read_model.sql; proyección del servidor en mastererp_refs.py.
 */
export interface Space {
  id: string;
  name: string;
}

export interface SpaceContext {
  tenant_id: string;
  modules: string[];
  permissions: string[];
  companies: Space[];
}

/** Documento de compra (solicitud, orden o factura de proveedor). */
export interface PurchaseDocument {
  ref?: string;
  id?: string;
  version?: number;
  fecha: string;
  numero: string | null;
  serie?: string | null;
  proveedor: string | null;
  moneda: string;
  moneda_base?: string | null;
  tipo_cambio?: string | null;
  cambio_fecha?: string | null;
  cambio_fuente?: string | null;
  total: string;
  total_base?: string | null;
  estado: string;
  editable?: boolean;
  lineas?: Array<{ descripcion: string; cantidad: string; precio_unitario: string; total?: string }>;
}

/** Tercero (proveedor o cliente). */
export interface Party {
  ref?: string;
  id?: string;
  codigo: string;
  nombre: string;
  version?: number;
  datos_generales?: Record<string, unknown> | null;
  contactos?: Array<Record<string, unknown>> | null;
  condiciones?: Record<string, unknown> | null;
  origen?: string | null;
  roles?: string[] | null;
}

/** Venta: importes como cadenas decimales. */
export interface Sale {
  ref?: string;
  id?: string;
  numero: string;
  fecha: string;
  estado: string;
  origen: string | null;
  cliente: { codigo: string; nombre: string } | null;
  pedido: { numero: string } | null;
  moneda: string;
  decimales?: number;
  total: string;
  moneda_base?: string | null;
  decimales_base?: number | null;
  total_base?: string | null;
  tipo_cambio?: string | null;
  cambio_fecha?: string | null;
  cambio_fuente?: string | null;
  lineas?: Array<{
    posicion: number;
    descripcion: string;
    cantidad: string;
    precio_unitario: string;
    subtotal?: string;
    descuento?: string;
    recargo?: string;
    tributos?: string;
    total: string;
  }>;
}

export type FinanceCollection = 'compras/solicitudes' | 'compras/ordenes' | 'compras/facturas' | 'proveedores' | 'clientes' | 'ventas';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
