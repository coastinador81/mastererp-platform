# Catalog frontend

## Rediseño administrativo de Catálogo — noviembre 2026

La interfaz React integrada de Productos, Categorías, Atributos, Marcas y
Proveedores comparte `src/CatalogPage.jsx`, `CatalogListPage.jsx`,
`CatalogEditorPage.jsx`, `catalogModel.mjs` y `catalog.css`. Los componentes
Toolbar, Table, StatusBadge, BulkActions, FormSection, PublishPanel y EmptyState
se componen dentro de esos archivos; no hay cinco copias de una página.
Las cargas de listados y fichas de las cinco entidades reutilizan
`frontend/shared/loading-state/LoadingState.jsx`, el mismo spinner de Operaciones,
sin duplicar estilos ni modificar las solicitudes al backend.
Los entrypoints funcionales conservan sus rutas y propietarios. Los `main.js`
standalone históricos permanecen sin cambios; esta entrega moderniza el admin
React de Ecommerce, no esos frontends independientes.

Inventario técnico: el shell está en `../src/EcommerceApp.jsx`, la sesión y
el cliente autenticado en `frontend/app-shell/src/session.jsx`, los permisos
de rutas en `../src/access.mjs` y los enlaces hash en `detailRoutes.mjs`.
Los componentes existentes de iconos, badges y espacio de trabajo se reutilizan.
El área usa React/JavaScript, no tiene hooks de catálogo ni tipos TypeScript
previos compartidos. El controlador mantiene efectos cancelables lógicamente
y descarta respuestas previas al navegar o cambiar contexto. No modifica
Cognito, API, permisos, contratos ni datos del servidor.

Contratos reales: GET/POST/PATCH en `/v1/products` y
`/v1/catalog/{categories,attributes,brands,suppliers}`. Fichas por ID, slug o
código, según entidad; `X-Tenant-Id`, permisos `catalog.<entidad>.write`, versión
optimista en PATCH e idempotencia en POST. Rutas existentes `#/<entidad>/<id>/view`
y nuevas altas `#/<entidad>/new`. Activación agrupada usa PATCH por registro,
se detiene ante un fallo e informa avance parcial. Exportación CSV local de
registros seleccionados, con neutralización de fórmulas de hoja de cálculo.

Límites explícitos: APIs de listado sin cursor, máximo 100 registros. Indicadores,
búsqueda local y páginas representan solo registros cargados; Productos conserva
además búsqueda remota por nombre/referencia y estado. No se inventan totales
globales, existencias, fechas ausentes ni borradores para entidades que solo
admiten ACTIVE/INACTIVE (Proveedores también BLOCKED). Altas distintas de Productos
se crean activas conforme al contrato; luego permiten editar el estado.

Productos conserva únicamente la pestaña Precio; no muestra stock ni campos
de inventario/impuesto simulados. Un enlace al módulo canónico de Inventario
abre su aplicación en otra pestaña, sin enviar tokens ni contexto por URL.

Simulaciones marcadas, únicamente en memoria y descartadas al salir: etiquetas,
previsualización de archivos y elección
de imagen principal local. La URL pública de imagen sí se guarda. La prueba de
eliminación confirma e informa que no elimina registros; no existe DELETE.
No se usan fixtures ni fallbacks de éxito en runtime. Los errores conservan
el formulario y no se presentan como un catálogo vacío.

Validación local: `npm run build` en Ecommerce; `node --test
2.3.4-catalog/src/catalogModel.test.mjs src/access.test.mjs
src/operationView.test.mjs ../../shared/auth/cognito.test.mjs`; nueve pruebas nuevas
de contratos, filtros, CSV, contexto y errores. Comprobaciones de Chrome con
fixtures aislados en `/tmp`: selección, paginación, ficha, pestañas, PATCH/version,
error de carga y editor móvil de 390 px sin overflow horizontal. No son E2E DEV.
Este paquete no define scripts de formato, lint ni TypeScript; no se acreditan.
El validador general mantiene advertencias preexistentes por node_modules y
renumeración. Pendientes: prueba autenticada en DEV y validación de escritura con
roles efectivos. Publicación DEV únicamente con autorización del propietario.

> Organización vigente: Catálogo conserva un único maestro de productos, categorías, atributos, marcas y referencias de proveedores, reutilizado por Ecommerce, Inventario, POS y Finanzas. Inventario físico pertenece a 2.1-inventory. Los apartados históricos conservados describen el contrato/estado previo cuando difieran; no modifican el mapa nuevo.


Objetivo específico: Mantener datos maestros de productos e inventario.

Responsabilidad: experiencia de catálogo e inventario. Estado: planned.

## Contrato y estado de esta capa

Código: 2.3.4. Nombre/ruta: `2.3-ecommerce/2.3.4-catalog`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Ecommerce / Catálogo compartido; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: la reserva documental no acredita implementación; conservar cualquier código/plantilla existente y revisar evidencia específica antes de marcar implementado.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.

<!-- ux-ui-standard:start -->
## UX/UI común

Aplicar el [estándar UX/UI de MasterERP](../../../../docs/UX_UI_STANDARD.md) antes de crear o modificar esta interfaz; el README conserva el alcance y estado funcional descritos arriba.

- Arimo local con fallback sans-serif; fondo #F6F8FC, superficies y menú blancos, texto #4B5563, secundario #667085 y acentos azules.
- Cuando haya tabla: 14 px, peso 400 y #667085 en todas las celdas; encabezados #F4F7FB y separadores #E8EDF3. Códigos y nombres sin negrita ni subrayado permanente.
- Reutilizar tokens y componentes. Títulos grises de peso 500, iconos de línea, espaciado consistente y adaptación a móvil.
- En listados con ficha, preservar enlace accesible en el nombre, teclado/nueva pestaña y selección de texto; hover/foco visibles y controles internos independientes.
- Habilitar búsqueda y acciones solo con comportamiento real y contrato autorizado, conservando tenant, empresa y permisos; mostrar carga, vacío, error y conflicto cuando correspondan.

Esta sección orienta el diseño; no acredita implementación ni añade requisitos funcionales. Ver la guía para composición aplicable, pruebas y variantes justificadas.
<!-- ux-ui-standard:end -->
