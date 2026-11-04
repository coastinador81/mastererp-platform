# Clientes y Proveedores — pantalla compartida

Responsabilidad: recorrido de terceros por empresa y rol, listado, detalle y formulario. Una sola implementación React en Platform frontend; las otras capas documentan la correspondencia. Usa las APIs de Administración existentes y el maestro compartido, sin recursos ni tablas por pantalla. No incorpora operaciones de otras capacidades.

Ficha ampliada conectada: `SupplierFields.jsx` es el formulario y resumen reutilizado por `Parties.jsx`. El menú abre el listado real y Crear proveedor abre la ficha. Exige contexto autorizado; no hay mocks ni borradores públicos como respaldo. Ver [contrato, campos y validación](../../../../../../docs/SUPPLIER_FORM_DEV.md).
