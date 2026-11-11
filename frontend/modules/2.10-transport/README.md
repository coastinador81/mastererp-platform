# Transport frontend

> Organización vigente: Transporte añade 2.10.5-routes para rutas de reparto, conservando repartidores, transportistas, Chipipro y MRW. Los apartados históricos conservados describen el contrato/estado previo cuando difieran; no modifican el mapa nuevo.


Objetivo específico: Gestionar repartidores y proveedores de transporte.

Responsabilidad: repartidores, transportistas, Chipipro y MRW. Estado: aplicación independiente implementada como candidata DEV; hosting pendiente de un rol autorizado de aprovisionamiento y publicación preparada, pero no ejecutada.

La aplicación visible se denomina **Repartidores** y usa el dominio canónico
`transporte-dev.uonify.com`. Comparte Cognito y contexto autorizado con Uonify,
pero conserva build y publicación propios. `tenant.owner` puede administrar
repartidores y rutas según sus permisos; ejecutar una entrega exige además un
perfil `ACTIVE` y `LINKED` asociado al usuario autenticado.

## Contrato y estado de esta capa

Código: 2.10. Nombre/ruta: `2.10-transport`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Transporte; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: la interfaz consume los contratos reales de Repartidores y Rutas, compila con la base administrativa de `frontend/shared/ui` y no importa estilos de Finanzas. El workflow local `publish-transport-dev.yml` exige el rol, bucket y distribución exclusivos que entregará el stack; no puede publicar hasta que esos recursos existan.

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
