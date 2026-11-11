# Cobros

Responsabilidad general: Organizar el registro y seguimiento de cobros.

Estado: bandeja y decisión de pagos electrónicos implementadas como candidato coordinado; publicación DEV pendiente.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

Contrato: `GET /v1/companies/{company_id}/finance/receipts/pending` y `POST /v1/companies/{company_id}/finance/receipts/{order_id}/review`. Validar crea la venta y confirma el pedido atómicamente; rechazar deja trazabilidad y bloquea el avance. Operaciones consume el estado como solo lectura.
