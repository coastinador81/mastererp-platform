# Pantallas compartidas de compras

Responsabilidad: listado, detalle, creación y edición de borradores de solicitudes, órdenes y facturas de proveedor, reutilizando una implementación visual y la Lambda Compras existente.

Frontend implementa las pantallas; Backend enruta en la Lambda propietaria de Gestión de compras; Database reutiliza documentos y comandos controlados. Infrastructure no declara recursos exclusivos para esta pantalla: resources.yml vacío y excluido del despliegue.

Estado: borradores básicos implementados y validados por HTTP/navegador en DEV; efectos financieros y aprobación pendientes. Ver [contrato y evidencia](../../../../../../../docs/PURCHASE_DRAFTS_DEV.md).

## Creación guiada en Administración

Desarrolladores e IA deben consultar el [patrón común de tres pasos](../../../../../../../docs/ADMINISTRATION_FORM_UX.md). Clientes/Proveedores: Datos básicos → Dirección y contactos → Condiciones. Órdenes: Datos de la orden → Detalles → Revisión. Reutilizar componentes y conservar contratos, permisos y datos. Candidato local; publicación pendiente.
