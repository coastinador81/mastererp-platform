# Gestión de compras

Responsabilidad general: Organizar proveedores y documentos administrativos de compras.

Estado: borradores básicos implementados en DEV; validación HTTP/visual aprobada. Aprobación, emisión y efectos financieros pendientes.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

## Submódulos

- [Proveedores](2.2.1.2.1-proveedores/README.md)
- [Solicitudes de compra](2.2.1.2.2-solicitudes-compra/README.md)
- [Órdenes de compra](2.2.1.2.3-ordenes-compra/README.md)
- [Facturas de proveedores](2.2.1.2.4-facturas-proveedores/README.md)

## Borradores conectados DEV

Solicitud → orden → factura de proveedor. Listado paginado, detalle, creación y edición con el maestro de proveedores existente. Una única Lambda Compras, Python 3.12, 256 MB, timeout 15 segundos y logs de 14 días. Las operaciones funcionales usan JWT, contexto validado y mastererp_app con comandos SQL controlados; no hay DML general. El diagnóstico GET /v1/administration/compras/health conserva su respuesta pública mínima.

API existente qx8nmypdhi y autorizador del stack mastererp-dev-onboarding. No se reimporta ni se cambia su CORS. El stack de Administración permanece anidado en Finanzas. Ver [contrato, despliegue y pruebas](../../../../../docs/PURCHASE_DRAFTS_DEV.md) y la pantalla compartida [purchases](screens/purchases/README.md).

<!-- ux-ui-standard:start -->
## UX/UI común

Aplicar el [estándar UX/UI de MasterERP](../../../../../docs/UX_UI_STANDARD.md) antes de crear o modificar esta interfaz; el README conserva el alcance y estado funcional descritos arriba.

- Inter local con fallback sans-serif; fondo #F6F8FC, superficies y menú blancos, texto #4B5563, secundario #667085 y acentos azules.
- Cuando haya tabla: 14 px, peso 400 y #667085 en todas las celdas; encabezados #F4F7FB y separadores #E8EDF3. Códigos y nombres sin negrita ni subrayado permanente.
- Reutilizar tokens y componentes. Títulos grises de peso 500, iconos de línea, espaciado consistente y adaptación a móvil.
- En listados con ficha, preservar enlace accesible en el nombre, teclado/nueva pestaña y selección de texto; hover/foco visibles y controles internos independientes.
- Habilitar búsqueda y acciones solo con comportamiento real y contrato autorizado, conservando tenant, empresa y permisos; mostrar carga, vacío, error y conflicto cuando correspondan.

Esta sección orienta el diseño; no acredita implementación ni añade requisitos funcionales. Ver la guía para composición aplicable, pruebas y variantes justificadas.
<!-- ux-ui-standard:end -->
