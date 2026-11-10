# Repartidores

Objetivo específico: Mantener repartidores y su disponibilidad autorizada.

Responsabilidad: Repartidores, dentro de Transporte.
Estado: interfaz integrada al Admin de E-commerce.

El listado abre una ficha independiente por repartidor, siguiendo el patrón de
detalle del catálogo. La ficha consume contratos reales para editar el perfil,
asignar nodos y consultar las rutas del repartidor con el resultado disponible
de cada parada. Las métricas se calculan sobre un máximo de 100 rutas devueltas
por la API; no representan un histórico completo cuando existe un volumen mayor.


## Contrato y estado de esta capa

Código: 2.10.1. Nombre/ruta: `2.10.1-drivers`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Transporte; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: interfaz integrada para consultar y editar perfiles, cambiar
disponibilidad, asignar nodos y revisar rutas. Cognito y el runtime común aportan
la identidad; el backend valida tenant, empresa, módulo y permisos en cada API.

Validaciones: tests del modelo de vista, build Vite y estructura local.
Pendientes: smoke autenticado en DEV y paginación del histórico superior a 100 rutas.

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
