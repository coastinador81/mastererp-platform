# Pedidos

El detalle sigue siendo una página completa. Las notas internas se leen y
persisten mediante la API autorizada. La descarga continúa siendo una vista
previa rotulada «NO ES UNA FACTURA FISCAL»; no emite documentos fiscales.
Impresión y transiciones permanecen reales.

Objetivo específico: Gestionar pedidos y sus transiciones autorizadas.

Responsabilidad: Pedidos, dentro de Ecommerce.
Estado: componente funcional integrado al código fuente del app-shell Uonify y
aplicación independiente compilable. La UI permite filtrar, listar, consultar
detalle y ejecutar manualmente las transiciones autorizadas del pedido. El
rediseño operativo agrega indicadores, búsqueda, tabla ejecutiva, progreso,
cliente, entrega, pago, productos, totales e historial real de transiciones
expuesto por el backend. Las notas internas de la ficha se leen y escriben por
la API autorizada; no se conservan solamente en el navegador.
La ficha también muestra los intentos reales de entrega registrados por Rutas,
incluidos resultado, motivo, fecha y métricas GPS disponibles, sin permitir que
Pedidos altere esa evidencia.
La cronología traduce los códigos internos y consolida los resultados históricos
desde la evidencia propietaria de Rutas, sin crear eventos retroactivos.
Los usuarios con `operations.orders.address.correct` pueden corregir la
dirección y coordenadas de un pedido elegible mediante el contrato backend; la
interfaz no geocodifica ni inventa coordenadas y no altera la libreta del cliente.


## Contrato y estado de esta capa

Código: 2.3.1. Nombre/ruta: `2.3.1-orders`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Ecommerce; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: aplicación Vite compilada con `npm run build`; consume las
cuatro rutas canónicas con bearer token y contexto tenant/empresa. La interfaz
no concede permisos: el backend/PostgreSQL vuelve a autorizar cada operación.
El directorio usa filtros y paginación por cursor en el backend. Las acciones
agrupadas usan un comando transaccional: se aplican todas o ninguna. La UI
niega escritura por defecto si no recibe el permiso real.

La lista y ficha de Pedidos consumen los fundamentos visuales `--uon-*` de
Platform para color, estados, superficies, radios, foco y movimiento. Conservan
Arimo, la composición operativa y los contratos existentes; no importan código
interno de `0-uonify/0.2-app`. La dependencia histórica de componentes de
Finanzas se retirará gradualmente cuando cada componente tenga propietario
compartido, sin duplicarlo dentro de Pedidos.

Validaciones: build independiente y build Uonify correctos. Pendientes para el
nuevo corte: publicación DEV y pruebas de navegador con identidad autorizada.

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
