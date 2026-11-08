# Centro de Agentes

Objetivo: configurar, activar y supervisar agentes que consumen Uonify, junto con su conocimiento, reglas de negocio, integraciones y aprobaciones.

## Fuente única del frontend

Este directorio es la fuente de verdad del frontend del Centro de Agentes. La entrada estática se encuentra en `agents-web/index.html`.

La infraestructura de `mastererp-infrastructure/modules/2.6-agent-center` solo conserva hosting, S3, CloudFront, DNS y permisos de publicación. No debe mantener una copia editable de esta interfaz.

## Alcance del primer front

- Inicio con estado operativo, acciones de preparación y catálogo de agentes.
- Navegación para agentes, conocimiento y reglas, flujos, aprobaciones, integraciones y supervisión.
- Estados iniciales sin integraciones, datos transaccionales ni acciones simuladas.
- Diseño responsive y accesible alineado con el estándar UX/UI de MasterERP.

## Publicación

El dominio DEV es `https://agentes-dev.uonify.com/`. La publicación debe construir o empaquetar esta entrada desde Platform; Infrastructure conserva el dominio y los recursos AWS asociados.

Antes de habilitar operaciones reales, definir contratos de tenant, empresa, permisos, APIs y auditoría. La navegación no concede acceso.

## Regla obligatoria de propiedad del frontend

**Todo código editable del Centro de Agentes vive exclusivamente en este módulo de Platform:** `frontend/modules/2.6-agent-center/`. La entrada publicada es `agents-web/index.html`.

Antes de editar una interfaz, un agente debe comprobar esta regla e informar al desarrollador si la petición apunta a Infrastructure. `mastererp-infrastructure` no es una fuente de frontend: solo mantiene CloudFront, S3, DNS, certificado, permisos OIDC y la infraestructura necesaria para publicar el artefacto generado desde Platform. No crear, copiar ni corregir HTML, CSS, JavaScript, assets o builds del Centro de Agentes en Infrastructure.

Una modificación de hosting no autoriza a cambiar la interfaz; una modificación de interfaz no autoriza a cambiar DNS, AWS, permisos ni despliegues. Si se requieren ambos cambios, deben tratarse como dos tareas coordinadas, indicando al desarrollador qué repositorio, recurso y publicación están implicados.

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

## Navegación visual — doble barra

La entrada de Platform reutiliza `frontend/shared/module-launcher/module-launcher.mjs` para los nueve puntos de la esquina superior derecha y para la barra de servicios relacionados (Chat, Finanzas, Ecommerce, Inventario y Agentes activo). Enlaces en la misma pestaña, sin tokens ni contexto en URL. No se modifica ninguna copia de Infrastructure.

El segundo nivel conserva las secciones existentes de Agentes. En escritorio parte compacto (64 px) y se expande sobre el contenido (256 px) al pasar el cursor o enfocar sus enlaces con teclado; se recoge al salir cuando no queda foco dentro. No desplaza el contenido. Las etiquetas y títulos siguen siendo accesibles en modo compacto. Respeta movimiento reducido.

En móvil, servicios en horizontal y menú funcional por botón; cierre por selección, fondo y Escape. Navegación interna mediante `?vista=...`, con recarga, historial y enlaces nativos. Las pantallas y operaciones existentes se conservan; la base no añade autenticación, permisos ni capacidades de agentes.

Vista local sin herramientas nuevas: `node scripts/preview_agents_frontend.mjs --port 5183` desde Platform, URL http://127.0.0.1:5183/. El servidor local solo expone la entrada y assets compartidos expresamente permitidos. Inter y su licencia se toman de la fuente ya existente de Finanzas, sin duplicar el archivo fuente.

El workflow propietario prepara HTML, lanzador, Inter y licencia desde Platform. Se modificó únicamente su empaquetado/publicación de archivos; no cambian roles, bucket, CloudFront, DNS o certificados. Validación local completada. Publicación mediante el workflow DEV propietario; su resultado se verifica en GitHub Actions y en el dominio, sin cambios de recursos AWS.

## Autenticación del publicador

Por indicación del propietario, el candidato del workflow de Agentes usa los secretos AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY del repositorio Platform, no OIDC. Las claves existentes solo en Infrastructure no se heredan ni se pueden recuperar desde GitHub. Deben configurarse de forma segura en Platform; nunca incorporarlas al código o logs. No se crean credenciales ni se cambia IAM para este ajuste. BUCKET y DISTRIBUTION siguen siendo variables no secretas del hosting existente. El cambio de autenticación queda pendiente de publicación hasta disponer de los secretos en Platform.
