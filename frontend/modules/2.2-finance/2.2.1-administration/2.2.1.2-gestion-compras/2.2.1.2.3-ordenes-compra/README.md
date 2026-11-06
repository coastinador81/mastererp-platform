# Órdenes de compra

Responsabilidad general: Organizar las órdenes de compra dirigidas a proveedores.

Estado: borradores básicos implementados en DEV; aprobación, emisión y efectos financieros pendientes.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

## Entrega básica de compras

Listado paginado, detalle, creación y edición de borradores conectados a documentos existentes. Secuencia solicitud → orden → factura, sin aprobación ni efectos financieros automáticos. Lambda Compras existente; recursos exclusivos en el YAML raíz propietario. Ver [contrato y validación](../../../../../../docs/PURCHASE_DRAFTS_DEV.md).

## Creación guiada en Administración

Desarrolladores e IA deben consultar el [patrón común de tres pasos](../../../../../../docs/ADMINISTRATION_FORM_UX.md). Clientes/Proveedores: Datos básicos → Dirección y contactos → Condiciones. Órdenes: Datos de la orden → Detalles → Revisión. Reutilizar componentes y conservar contratos, permisos y datos. Candidato local; publicación pendiente.
