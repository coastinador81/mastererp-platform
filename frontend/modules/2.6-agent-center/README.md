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
