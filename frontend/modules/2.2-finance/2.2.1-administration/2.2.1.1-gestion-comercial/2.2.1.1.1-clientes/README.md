# Clientes

Responsabilidad general: Gestionar la relación administrativa con clientes utilizando el maestro existente, sin duplicarlo.

Estado: CRUD administrativo conectado; campos comunes y condiciones por empresa. Situación financiera y documentos pendientes de conectar.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

Maestro canónico: catalogo.terceros y perfil cliente en administracion.perfiles_tercero. Ficha fiscal/contacto común a ambos roles; datos del canal permanecen en eCommerce. Ver docs/CUSTOMER_ADMINISTRATION.md del repositorio. No crear un maestro paralelo ni asignarlo a MasterCRM.

<!-- ux-ui-standard:start -->
## UX/UI común

Aplicar el [estándar UX/UI de MasterERP](../../../../../../docs/UX_UI_STANDARD.md) antes de crear o modificar esta interfaz; el README conserva el alcance y estado funcional descritos arriba.

- Inter local con fallback sans-serif; fondo #F6F8FC, superficies y menú blancos, texto #4B5563, secundario #667085 y acentos azules.
- Cuando haya tabla: 14 px, peso 400 y #667085 en todas las celdas; encabezados #F4F7FB y separadores #E8EDF3. Códigos y nombres sin negrita ni subrayado permanente.
- Reutilizar tokens y componentes. Títulos grises de peso 500, iconos de línea, espaciado consistente y adaptación a móvil.
- En listados con ficha, preservar enlace accesible en el nombre, teclado/nueva pestaña y selección de texto; hover/foco visibles y controles internos independientes.
- Habilitar búsqueda y acciones solo con comportamiento real y contrato autorizado, conservando tenant, empresa y permisos; mostrar carga, vacío, error y conflicto cuando correspondan.

Esta sección orienta el diseño; no acredita implementación ni añade requisitos funcionales. Ver la guía para composición aplicable, pruebas y variantes justificadas.
<!-- ux-ui-standard:end -->
