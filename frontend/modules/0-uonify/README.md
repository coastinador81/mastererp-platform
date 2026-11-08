# Uonify

## Experiencia integrada objetivo

En DEV, app-dev.uonify.com es la entrada general: dashboard común con chat y menú de módulos habilitados para el tenant y autorizados para el usuario. Finanzas, Productos, Categorías y Pedidos se componen dentro de ese espacio con navegación, identidad y contexto comunes; conversar es opcional. El primer recorrido usa composición en build y rutas hash; sus comprobaciones y límites se documentan en [la guía de integración](../../../docs/FINANCE_UI_INTEGRATION.md). El alojamiento independiente de cada módulo se conserva para pruebas. Ver [contrato oficial](../../../docs/FRONTEND_ARCHITECTURE.md).

Objetivo específico: Canal conversacional y de voz para consultar y coordinar operaciones con los módulos propietarios.

Responsabilidad: Chat, voz, memoria, conversaciones, selección de modelos, guardas y orquestación. Cerebro principal compartido.
Estado: estructura funcional; implementación pendiente.


## Contrato y estado de esta capa

Código: 0. Nombre/ruta: `0-uonify`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Uonify; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: la reserva documental no acredita implementación; conservar cualquier código/plantilla existente y revisar evidencia específica antes de marcar implementado.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.

<!-- ux-ui-standard:start -->
## UX/UI común

Aplicar el [estándar UX/UI de MasterERP](../../../docs/UX_UI_STANDARD.md) antes de crear o modificar esta interfaz; el README conserva el alcance y estado funcional descritos arriba.

- Inter local con fallback sans-serif; fondo #F6F8FC, superficies y menú blancos, texto #4B5563, secundario #667085 y acentos azules.
- Cuando haya tabla: 14 px, peso 400 y #667085 en todas las celdas; encabezados #F4F7FB y separadores #E8EDF3. Códigos y nombres sin negrita ni subrayado permanente.
- Reutilizar tokens y componentes. Títulos grises de peso 500, iconos de línea, espaciado consistente y adaptación a móvil.
- En listados con ficha, preservar enlace accesible en el nombre, teclado/nueva pestaña y selección de texto; hover/foco visibles y controles internos independientes.
- Habilitar búsqueda y acciones solo con comportamiento real y contrato autorizado, conservando tenant, empresa y permisos; mostrar carga, vacío, error y conflicto cuando correspondan.

Esta sección orienta el diseño; no acredita implementación ni añade requisitos funcionales. Ver la guía para composición aplicable, pruebas y variantes justificadas.
<!-- ux-ui-standard:end -->
