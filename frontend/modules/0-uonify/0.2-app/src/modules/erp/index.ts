/**
 * Módulo erp: servicio ERP · Finanzas del espacio de trabajo, con la mesa de Producto
 * (menú de Finanzas o lista a la izquierda; conversación con Uony o ficha en el centro).
 * Sus rutas (/espacio/erp…) se declaran en routes.tsx y se registran solas.
 *
 * Datos: con la cuenta del ERP conectada, los reales de la API de Finanzas del equipo (en
 * dev.uonify.com, a través del servidor de Uonify, que custodia la cuenta como Drive); sin
 * conexión, en la vista local, los de ejemplo de la demo del equipo, marcados como ficticios.
 * Resumen y Sugerencias son vistas de diseño con datos de ejemplo.
 *
 *   ErpConversationConnection  tarjeta del ERP en la conversación (show_connection «erp»)
 *
 *   FINANCE_BASE_PATH          /espacio/erp
 *   apartadoPath(ruta)         un apartado del menú (/espacio/erp/solicitudes-compra)
 *   purchasePath(ref)          ficha de una compra (/espacio/erp/solicitudes-compra/DEMO-COM-001)
 */
export { FINANCE_BASE_PATH, apartadoPath, purchasePath } from './model/paths';
export { ErpConversationConnection } from './components/ErpConversationConnection';
