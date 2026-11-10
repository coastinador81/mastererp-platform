/** Rutas del servicio ERP · Finanzas dentro del espacio de trabajo. */
export const FINANCE_BASE_PATH = '/espacio/erp';

/** Rutas de los apartados en el menú del equipo (vista=…). */
export const PURCHASES_ROUTE = 'solicitudes-compra';
export const ORDERS_ROUTE = 'ordenes-compra';
export const SUMMARY_ROUTE = 'resumen-compras';
export const SUGGESTIONS_ROUTE = 'sugerencias-compras';

/** Apartados que se abren como lista en el panel (los demás, en el centro). */
export const LIST_ROUTES: readonly string[] = [PURCHASES_ROUTE, ORDERS_ROUTE];

/** Un apartado del menú: /espacio/erp/solicitudes-compra. */
export const apartadoPath = (route: string): string => `${FINANCE_BASE_PATH}/${route}`;

/** Ficha de un documento: /espacio/erp/ordenes-compra/DEMO-OC-001. */
export const documentPath = (route: string, reference: string): string => `${apartadoPath(route)}/${encodeURIComponent(reference)}`;

/** Ficha de una compra: /espacio/erp/solicitudes-compra/DEMO-COM-001. */
export const purchasePath = (reference: string): string => documentPath(PURCHASES_ROUTE, reference);
