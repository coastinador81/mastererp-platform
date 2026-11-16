# Rutas

Objetivo específico: Planificar recorridos operativos sin poseer repartidores.

Responsabilidad: Rutas, dentro de Transporte.
Estado: interfaz integrada al Admin de E-commerce.

El Admin permite crear una ruta seleccionando nodo, fecha, franja y pedidos
`READY` sin ruta del mismo nodo. El backend crea la ruta y asigna sus pedidos
en una única operación idempotente, con autorización real
`operations.routes.write`. Usa la sesión runtime del app-shell y conserva el
aislamiento por tenant y empresa.
El directorio presenta primero la fecha de ruta más reciente; para rutas del
mismo día desempata por fecha de creación e identificador de forma estable.

El repartidor registra `DELIVERED` únicamente con evidencia GPS precisa y
dentro del radio permitido. `FAILED` exige un motivo, devuelve el pedido a
`READY` sin ruta y no exige ubicación. Al resolver la última parada, Database
cierra la ruta y libera al repartidor de forma transaccional. La interfaz cuenta
paradas resueltas incluyendo entregas y no entregas.


## Contrato y estado de esta capa

Código: 2.10.5. Nombre/ruta: `2.10.5-routes`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Transporte; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: build Vite local aprobado. Integración Uonify y smoke DEV pendientes.

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
