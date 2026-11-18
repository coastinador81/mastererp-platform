# Cobros

Responsabilidad general: Organizar el registro y seguimiento de cobros.

Estado: bandeja, historial y decisión de pagos electrónicos implementados como candidato coordinado; publicación DEV pendiente.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

Contrato: `GET /v1/companies/{company_id}/finance/receipts/pending` y `POST /v1/companies/{company_id}/finance/receipts/{order_id}/review`. La ruta GET conserva su nombre por compatibilidad y devuelve pendientes más decisiones cerradas, recientes primero. Validar crea la venta y confirma el pedido atómicamente; rechazar permanece en Cobros como historial de solo lectura y bloquea el avance. Operaciones consume el estado como solo lectura.

Cancelaciones pagadas: `GET /finance/refund-accounts`, `GET
/finance/receipts/{order_id}/credit-notes` y `POST
/finance/receipts/{order_id}/refund`. El POST es idempotente y atómico: exige
una cuenta/caja en la moneda del pedido y una nota de crédito compatible ya
sellada; crea el egreso, el movimiento de salida y el evento consolidado de
Pedidos. No genera documentos fiscales desde el navegador.

Cuando la moneda del pedido difiere de la moneda base de la empresa, validar exige tasa, fecha efectiva y fuente dentro de la evidencia. La venta conserva esos valores; rechazar no requiere conversión y el backend nunca inventa una tasa.
