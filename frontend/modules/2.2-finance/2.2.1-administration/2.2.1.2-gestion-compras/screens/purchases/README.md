# Pantallas compartidas de compras

Responsabilidad: listado, detalle, creación y edición de borradores de solicitudes, órdenes y facturas de proveedor, reutilizando una implementación visual y la Lambda Compras existente.

Frontend implementa las pantallas; Backend enruta en la Lambda propietaria de Gestión de compras; Database reutiliza documentos y comandos controlados. Infrastructure no declara recursos exclusivos para esta pantalla: resources.yml vacío y excluido del despliegue.

Estado: borradores básicos implementados y validados por HTTP/navegador en DEV; efectos financieros y aprobación pendientes. Ver [contrato y evidencia](../../../../../../../docs/PURCHASE_DRAFTS_DEV.md).

<!-- ux-ui-standard:start -->
## UX/UI común

Aplicar el [estándar UX/UI de MasterERP](../../../../../../../docs/UX_UI_STANDARD.md) antes de crear o modificar esta interfaz; el README conserva el alcance y estado funcional descritos arriba.

- Inter local con fallback sans-serif; fondo #F6F8FC, superficies y menú blancos, texto #4B5563, secundario #667085 y acentos azules.
- Cuando haya tabla: 14 px, peso 400 y #667085 en todas las celdas; encabezados #F4F7FB y separadores #E8EDF3. Códigos y nombres sin negrita ni subrayado permanente.
- Reutilizar tokens y componentes. Títulos grises de peso 500, iconos de línea, espaciado consistente y adaptación a móvil.
- En listados con ficha, preservar enlace accesible en el nombre, teclado/nueva pestaña y selección de texto; hover/foco visibles y controles internos independientes.
- Habilitar búsqueda y acciones solo con comportamiento real y contrato autorizado, conservando tenant, empresa y permisos; mostrar carga, vacío, error y conflicto cuando correspondan.

Esta sección orienta el diseño; no acredita implementación ni añade requisitos funcionales. Ver la guía para composición aplicable, pruebas y variantes justificadas.
<!-- ux-ui-standard:end -->

## Creación guiada en Administración

Desarrolladores e IA deben consultar el [patrón común de tres pasos](../../../../../../../docs/ADMINISTRATION_FORM_UX.md). Clientes/Proveedores: Datos básicos → Dirección y contactos → Condiciones. Órdenes: Datos de la orden → Detalles → Revisión. Reutilizar componentes y conservar contratos, permisos y datos. Candidato local; publicación pendiente.

## Resumen — diseño local

`PurchasesSummary.jsx` prepara indicadores de liquidez disponible, cuentas por pagar, reservas financieras, notas de crédito, devoluciones y descuentos. Todos los valores son guiones; no hay cifras, monedas ni fórmulas asumidas. Incluye tablas vacías de proveedores y reservas. La entrada local `/?vista=resumen-compras` (Vite DEV, sin id/accion) utiliza el montaje aislado descrito en `src/local/README.md` desde la raíz de Finanzas. No monta sesión ni consulta APIs. El listado, creación, detalle y edición existentes conservan su implementación; esta vista se incluye como demostración separada en el build DEV con el parámetro demo=compras, sin sustituir las rutas conectadas.

El resumen local incorpora filtros por nodo, fecha desde/hasta y moneda (Bs. por defecto, USD o EUR; sin opción Todas las monedas). Los nodos son ejemplos identificados únicamente en la vista de diseño. Los filtros cambian el ámbito visual, no consultan APIs ni calculan/convierten importes; las definiciones de fecha de corte, agregación y tasas se decidirán antes de conectar datos.

Resumen es la primera entrada de Gestión de compras en la revisión local. Compras queda libre del resumen y conserva sus CRUD y contratos existentes. Es una demostración visual y no modifica backend. La publicación usa la entrada /?demo=compras&vista=resumen-compras.
