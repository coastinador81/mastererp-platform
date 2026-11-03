# Proveedores

Responsabilidad general: Gestionar la relación administrativa de compras con los proveedores del maestro de Catálogo, sin duplicarlo.

Estado: pendiente de implementación.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

Maestro de referencia: [Proveedores de Catálogo](../../../../2.1-catalog/2.1.5-suppliers/README.md). Esta dependencia documental no acredita que el maestro esté implementado; consumir su contrato cuando exista, sin copiar sus datos.

## Diagnóstico técnico DEV

Función: `mastererp-dev-adm-proveedores`. Estado funcional: pendiente de implementación; el handler mínimo no implementa operaciones de proveedores. Código en [handler.py](lambdas/mastererp-dev-adm-proveedores/handler.py). Python 3.12, 128 MB, timeout 5 segundos; logs con retención de 14 días. Con ruta GET técnica pública en el API administrativo existente; sin Function URL, acceso a datos ni secretos. Ver procedimiento de empaquetado, despliegue y verificación en Administración.

## Capacidad funcional de terceros

Se implementan listado paginado, detalle, creación idempotente y actualización versionada mediante el maestro de terceros y perfiles por empresa (SQL 014). La sección de diagnóstico anterior describe la fase histórica; /health se conserva. Contrato vigente: docs/ADMINISTRATION_PARTIES.md en la raíz de Platform. Sin frontend ni fiscalidad.
