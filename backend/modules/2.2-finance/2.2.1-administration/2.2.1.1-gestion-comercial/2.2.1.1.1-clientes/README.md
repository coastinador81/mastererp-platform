# Clientes

Responsabilidad general: Gestionar la relación administrativa con clientes utilizando el maestro existente, sin duplicarlo.

Estado: primera capacidad de terceros implementada en DEV; ver evidencia y límites al final.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

Maestro vigente: catalogo.terceros y catalogo.roles_tercero por tenant; administracion.perfiles_tercero por empresa. Sin duplicar entidades por rol.

## Diagnóstico técnico DEV (histórico)

Función: `mastererp-dev-adm-clientes`. Estado funcional: pendiente de implementación; el handler mínimo no implementa operaciones de clientes. Código en [handler.py](lambdas/mastererp-dev-adm-clientes/handler.py). Python 3.12, 128 MB, timeout 5 segundos; logs con retención de 14 días. Con ruta GET técnica pública en el API administrativo existente; sin Function URL, acceso a datos ni secretos. Ver procedimiento de empaquetado, despliegue y verificación en Administración.

## Capacidad funcional de terceros

Se implementan listado paginado, detalle, creación idempotente y actualización versionada mediante el maestro de terceros y perfiles por empresa (SQL 014). La sección de diagnóstico anterior describe la fase histórica; /health se conserva. Contrato vigente: docs/ADMINISTRATION_PARTIES.md en la raíz de Platform. Sin frontend ni fiscalidad.

## Cierre funcional de esta entrega

Listar paginado, detalle, crear y actualizar se comprobaron por API Gateway con JWT y persistencia real. Funciones SQL 014 y credenciales mastererp_app; sin escritura general. El historial de diagnóstico anterior no representa el estado actual de esta capacidad. Contratos y evidencia: docs/ADMINISTRATION_PARTIES.md en cada repositorio y docs/ADMINISTRATION_PARTIES_DEV.md en Database.

## Ficha administrativa común validada

Maestro catalogo.terceros; perfiles por empresa/rol en administracion.perfiles_tercero.
044 incorpora ficha fiscal/contacto común sin duplicar clientes como proveedores;
045 proyecta teléfonos legacy en lectura, sin backfill. Condiciones específicas de
empresa y rol; eCommerce conserva cuenta y direcciones de entrega. APIs existentes
GET/POST/PATCH /v1/administration/clientes con JWT, permisos, versiones e idempotencia.
Lambda mastererp-dev-adm-clientes actualizada en stack Finanzas/Administración,
sin nuevas rutas/recursos ni cambios de Compras. 19 casos HTTP y siete de navegador
DEV aprobados con fixtures aisladas y limpieza. Situación financiera/documentos
pendientes; no simular importes. Contrato y evidencia en Platform/docs/CUSTOMER_ADMINISTRATION.md
y Database/docs/CUSTOMER_ADMINISTRATION_DEV.md.
