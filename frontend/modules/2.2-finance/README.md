# Finanzas — frontend principal

> Organización vigente: Finanzas conserva toda la numeración de Administración y añade 2.2.5-hr para empleados, nómina y ausencias, con permisos específicos. Los apartados históricos conservados describen el contrato/estado previo cuando difieran; no modifican el mapa nuevo.


Objetivo específico: Coordinar los dominios financieros sin mezclar ejecución operativa.

Responsabilidad: experiencia financiera. Estado: planned.

## Contrato y estado de esta capa

Código: 2.2. Nombre/ruta: `2.2-finance`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Finanzas; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: la reserva documental no acredita implementación; conservar cualquier código/plantilla existente y revisar evidencia específica antes de marcar implementado.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.

## Jerarquía de infraestructura

Se conserva la ruta y responsabilidad funcional. La composición Finanzas → Administración y las reservas de Contabilidad/BI se documentan en [docs/FINANCE_HIERARCHY.md](../../../docs/FINANCE_HIERARCHY.md). En Infrastructure, cada recurso permanece en el YAML raíz de su carpeta propietaria; una carpeta no obliga a crear un stack. El resultado AWS se informa por separado en el mapa y evidencia de Infrastructure.

## Navegación y unidad de entrega objetivo

Finanzas agrupa Administración, Contabilidad, BI y capacidades asociadas. Es una aplicación conectada al producto principal Uonify, con identidad y contexto comunes, y mantiene componentes, build, pipeline, despliegue y rollback propios. Su entrada DEV vigente es `finanzas-dev.uonify.com`; el recorrido por `app-dev.uonify.com` queda como evidencia histórica de composición. No se exige conversar para operar y Administración no tiene frontend separado. Ver [contrato oficial](../../../docs/FRONTEND_ARCHITECTURE.md).

## Primer recorrido DEV (sustituye la página inicial)

Entrada index.html y src/main.js; src/Finance.jsx y pantalla compartida de Clientes/Proveedores bajo Administración. Usa el shell y sesión comunes, APIs reales, selección de empresa y controles de autorización del backend. React/Vite fijados por lockfile, sin secretos. Build independiente y composición en el front general desde el mismo código. Ver [contrato de implementación y evidencia](../../../docs/FINANCE_UI_INTEGRATION.md). Otras operaciones financieras siguen pendientes.

```powershell
cd frontend/modules/2.2-finance
npm ci
npm run build
```

Artefacto: `dist/`, no versionado. Node 24 en CI. Configuración por modo Vite: `npm exec -- vite build --mode <ambiente>`; solo DEV está configurado y autorizado. No crea QA/PROD. No se necesita servidor ni dependencias runtime en hosting.

Publicación propia: `.github/workflows/publish-finance-dev.yml`, al cambiar código/build de esta aplicación en dev o mediante dispatch. Autenticación GitHub OIDC, sin claves AWS. Las variables no secretas FINANCE_DEV_BUCKET y FINANCE_DEV_DISTRIBUTION_ID proceden de outputs del stack propietario de hosting. Publica assets con hash antes del HTML, conserva versiones anteriores y después invalida `/` y `/index.html`. No publica otros módulos.

Destino DEV: https://finanzas-dev.uonify.com. El resultado real y recursos se registran en Infrastructure `modules/2.2-finance/HOSTING.md`. Es un acceso independiente de desarrollo y pruebas, no la navegación objetivo del usuario final. No es obligatorio crear finanzas.uonify.com en producción; la primera integración usa composición de código en build y su validación se registra en la guía enlazada. Recuperación: revertir únicamente archivos de esta aplicación y publicar dev para reconstruir el artefacto previo; no eliminar stacks ni cambiar DNS. El HTML estático no contiene datos de clientes; las operaciones requieren sesión y son autorizadas por API. No se acredita cobertura completa de Finanzas.

## Acabado visual de Finanzas

La base administrativa vive en [frontend/shared/ui/admin-application.css](../../shared/ui/admin-application.css) y es consumida por Finanzas, Ecommerce y Transporte. Finanzas añade únicamente su tema `uonify-brand`. Los alias `--finance-*` se conservan para compatibilidad mientras los consumidores migran a `--uon-*`; no son propiedad visual exclusiva de Finanzas.

Inter variable se sirve desde el artefacto propio, con fallback sans-serif; fuente, procedencia y licencia en [assets/fonts](src/assets/fonts/README.md). La tabla usa 14 px, peso 400 y #667085, incluidos nombres y códigos; los encabezados usan #F4F7FB y separadores #E8EDF3. El nombre del proveedor conserva su enlace y el clic de fila existente; el buscador consulta los proveedores autorizados por nombre, código e identificación fiscal. No se añaden filtros adicionales ni operaciones de escritura.

Validación local: `node scripts/validate_supplier_row_ux.cjs --finance-theme` desde la raíz de Platform, con Playwright/Chrome disponibles en el entorno existente. El arnés usa los componentes reales con fixtures exclusivamente de prueba, sin llamadas a servicios ni sesión real; las capturas se guardan en `frontend/modules/2.2-finance/node_modules/.cache/finance-visual-ux/`. Ejecutar también el build y el validador estructural. Esta documentación y las capturas locales no acreditan un despliegue en DEV.

Revisión local de este acabado: 20 comprobaciones de navegador aprobadas, incluyendo estilos calculados, carga local de Inter, contraste del texto normal (mínimo 4,57:1 en los estados de tabla), navegación, nueva pestaña, selección de texto, controles, paginación, permisos y menú móvil. El acabado posterior incorpora la referencia Refined Supplier Dashboard Typography, con iconografía de línea y buscador funcional. Las capturas usan fixtures exclusivamente de prueba y no datos ni sesión de DEV.

## Referencia visual de Proveedores y búsqueda

El listado sigue la referencia con breadcrumb, subtítulo, iconos del menú, icono de creación y buscador. Muestra cinco columnas (código, nombre, identificación fiscal, correo y teléfono); los roles se conservan en el modelo y la ficha, sin duplicar ni modificar datos.

La API vigente solo admite company_id, limit y after: no se envían parámetros de búsqueda inexistentes. Al escribir, el frontend recorre sus páginas autorizadas con limit=100 y filtra por nombre, código o identificación fiscal, sin distinguir tildes/mayúsculas. No se limita a la página visible. Los resultados se paginan de diez en diez; el contador deriva de los datos, nunca se fija en ocho. Si una página falla, no se presentan resultados parciales como completos. Se detiene la lectura al salir o cambiar contexto y no hay almacenamiento persistente del índice; el cambio de empresa reinicia búsqueda y caché.

Esta estrategia mantiene el alcance frontend y funciona con la API existente. Para catálogos grandes queda pendiente incorporar búsqueda en servidor en su módulo propietario; no es una búsqueda escalable de base de datos ni se afirma que haya sido probada en DEV por estas pruebas locales. No se ejecutan SQL, cambios de IAM ni recursos AWS.

Validación de esta revisión: 26 comprobaciones locales de navegador y seis pruebas del lector/buscador. Incluyen coincidencias fuera de la primera página, nombre/código/fiscal, tildes, vacío, limpiar, paginación de coincidencias, cambio de empresa sin caché anterior, interacción de filas, teclado, nueva pestaña, contraste y móvil. Las ocho filas DEMO de las capturas son exclusivamente fixtures del arnés, nunca un fallback del frontend desplegable.

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

## Creación guiada en Administración

Desarrolladores e IA deben consultar el [patrón común de tres pasos](../../../docs/ADMINISTRATION_FORM_UX.md). Clientes/Proveedores: Datos básicos → Dirección y contactos → Condiciones. Órdenes: Datos de la orden → Detalles → Revisión. Reutilizar componentes y conservar contratos, permisos y datos. Candidato local; publicación pendiente.

## Navegacion adaptable de Finanzas

El frontend independiente y la demo de Compras reutilizan los servicios relacionados de Platform: Chat, Finanzas, Ecommerce, Inventario y Agentes. El menu funcional ocupa 64 px y se expande al pasar el mouse, recibir foco o usar el boton del encabezado; en escritorio reserva su ancho en el layout y el contenido central se reorganiza automaticamente sin quedar cubierto. Conserva las agrupaciones de Administracion y las restricciones existentes. En movil se abre como panel con cierre exterior y Escape; seleccionar una ruta cierra el panel. Las tarjetas se ajustan al ancho real del contenido y las tablas conservan desplazamiento horizontal interno. Esta presentacion no cambia permisos, contratos, datos ni operaciones. Los estilos quedan limitados a la entrada `finance-app`; Uonify conserva su presentacion.

## Entrada de trabajo visual DEV

En el build DEV, la raiz de Finanzas abre el Resumen de Compras y su menu permite recorrer Compras, Sugerencias y Ordenes con las pantallas de diseno existentes. Se conserva la etiqueta DEMO y los datos ficticios no se guardan en backend. Los enlaces historicos `demo=compras` siguen disponibles. Clientes, Proveedores, Ventas y Facturas abren sus pantallas existentes con autenticacion y autorizacion; no se simulan permisos. Compras registradas y Ordenes registradas conservan accesos explicitos a las operaciones reales (`vista=solicitudes-compra&datos=reales` y `vista=ordenes-compra&datos=reales`). La entrada `/?datos=reales` conserva el resumen funcional anterior. Las nuevas entradas visuales no se habilitan fuera del modo DEV ni sustituyen APIs.

## Panel contextual de IA

El icono de destellos del encabezado abre el asistente de Finanzas, tanto en las vistas demo como en las pantallas reales. En escritorio amplio reserva una columna derecha y el contenido central ajusta su ancho; en tablet/movil se presenta como dialogo con fondo inactivo, foco contenido, cierre por Escape, cierre exterior y retorno al boton. Identifica la pantalla activa sin leer ni enviar registros. El borrador se conserva en memoria al cerrar/abrir durante esa visita; no hay almacenamiento persistente ni envio de mensajes. Estado: interfaz preparada, IA sin conectar. El boton de enviar permanece deshabilitado; no hay respuestas ficticias ni nuevas llamadas a APIs, modelos o secretos. La integracion real requiere una entrega y contrato posteriores.

## Identidad de Uonify en Finanzas (capa `uonify-brand`)

Excepción del propietario (08-11-2026): Finanzas adopta el manual de identidad corporativa de Uonify. La regla y su alcance están en el [`README.md` de la raíz](../../../README.md) y en [`frontend/AGENTS.md`](../../AGENTS.md); este README solo la resume y no define identidad.

Mecanismo: la hoja [src/uonify-theme.css](src/uonify-theme.css) ajusta los alias de compatibilidad bajo `:root.finance-app.uonify-brand` y se importa después de la base compartida. Se activa solo con la clase marcadora `uonify-brand` en esta aplicación. Ecommerce y Transporte consumen la base, pero no activan el tema financiero.

Mapeo (fase 1, solo color): azul de acción Azul 600 `#006AE1` (cumple AA como texto y como relleno; §12 «regla del 600»), aro de foco Azul Uonify `#0178F7`, titulares Tinta `#0A0B0D`, cuerpo y apoyo en Neutros del manual, error semántico `#B3261E`. El espaciado (retícula de 8), los radios (8/12) y la tipografía (Inter) del tema base ya cumplían el manual. En fases siguientes: datos técnicos en monoespaciada, iconos neutros y el panel de IA en aqua con el isotipo «ON».

Alcance: fase 1, solo visual, en la Finanzas independiente (finanzas-dev). No cambia funcionalidad, APIs, rutas, permisos ni datos.

## Tema claro, oscuro y automatico

El selector de tema en la cabecera ofrece Automatico, Claro y Oscuro. Se aplica a pantallas, tablas, formularios, fichas, menus y panel Uony; conserva los contratos funcionales. La preferencia se guarda localmente por subdominio, no se presupone sincronizacion de preferencias ni sesion entre aplicaciones. Leer [la implementacion compartida y pruebas](../../../docs/ADMINISTRATIVE_THEMES.md) antes de ampliar estilos; no introducir superficies blancas o texto oscuro fijos en componentes nuevos.
