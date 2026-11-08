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
