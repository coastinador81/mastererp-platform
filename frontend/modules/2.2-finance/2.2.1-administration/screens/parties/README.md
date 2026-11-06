# Clientes y Proveedores — pantalla compartida

Responsabilidad: recorrido de terceros por empresa y rol, listado, detalle y formulario. Una sola implementación React en Platform frontend; las otras capas documentan la correspondencia. Usa las APIs de Administración existentes y el maestro compartido, sin recursos ni tablas por pantalla. No incorpora operaciones de otras capacidades.

Ficha ampliada conectada: `SupplierFields.jsx` es el formulario y resumen reutilizado por `Parties.jsx`. El menú abre el listado real y Crear proveedor abre la ficha. Exige contexto autorizado; no hay mocks ni borradores públicos como respaldo. Ver [contrato, campos y validación](../../../../../../docs/SUPPLIER_FORM_DEV.md).

## Navegación del listado de Proveedores

El nombre es un enlace nativo a la ficha; admite teclado, Enter y apertura en otra pestaña. El resto de la fila abre la misma ficha mediante la navegación existente, salvo al seleccionar texto, usar modificadores o interactuar con controles internos. Hover y foco se limitan a la tabla de proveedores. Clientes conserva su columna Acción y su enlace Ver detalle.

El listado de proveedores se presenta en SupplierDirectory.jsx y conserva cinco columnas según la referencia visual; los roles siguen en la ficha. supplierSearch.mjs recorre todas las páginas autorizadas de la empresa para buscar por nombre, código e identificación fiscal; useSupplierDirectory.jsx mantiene el índice solo durante la vista y descarta respuestas tras un cambio de contexto. La API no se modifica y la búsqueda de servidor para grandes volúmenes permanece pendiente. Los errores de páginas intermedias se muestran, sin afirmar que una búsqueda parcial está completa.

## Creación guiada en Administración

Desarrolladores e IA deben consultar el [patrón común de tres pasos](../../../../../../docs/ADMINISTRATION_FORM_UX.md). Clientes/Proveedores: Datos básicos → Dirección y contactos → Condiciones. Órdenes: Datos de la orden → Detalles → Revisión. Reutilizar componentes y conservar contratos, permisos y datos. Candidato local; publicación pendiente.
