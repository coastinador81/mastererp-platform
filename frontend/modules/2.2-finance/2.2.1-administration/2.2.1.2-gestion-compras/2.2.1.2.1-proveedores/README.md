# Proveedores

Responsabilidad general: Gestionar la relación administrativa de compras con los proveedores del maestro de Catálogo, sin duplicarlo.

Estado: ficha ampliada integrada con la API real; validación DEV registrada en la guía enlazada.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

Maestro de referencia: [Proveedores de Catálogo](../../../../2.3-ecommerce/2.3.4-catalog/2.3.4.5-suppliers/README.md). Esta dependencia documental no acredita que el maestro esté implementado; consumir su contrato cuando exista, sin copiar sus datos.

La ficha visual incluye datos generales/fiscales, dirección, comunicación, personas de contacto y condiciones comerciales. Ver [campos y límites de la entrega](../../../../../../docs/SUPPLIER_FORM_DEV.md). La ficha usa el proveedor canónico y su perfil de empresa mediante comandos autorizados, sin duplicar el maestro.

## Creación guiada en Administración

Desarrolladores e IA deben consultar el [patrón común de tres pasos](../../../../../../docs/ADMINISTRATION_FORM_UX.md). Clientes/Proveedores: Datos básicos → Dirección y contactos → Condiciones. Órdenes: Datos de la orden → Detalles → Revisión. Reutilizar componentes y conservar contratos, permisos y datos. Candidato local; publicación pendiente.
