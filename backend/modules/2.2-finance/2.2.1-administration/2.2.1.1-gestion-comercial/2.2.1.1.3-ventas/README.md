# Ventas

Responsabilidad general: Organizar la gestión administrativa de las ventas.

Estado: pendiente de implementación.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

## Diagnóstico técnico DEV

Función: `mastererp-dev-adm-ventas`. Estado funcional: pendiente de implementación; el handler mínimo no implementa operaciones de ventas. Código en [handler.py](lambdas/mastererp-dev-adm-ventas/handler.py). Python 3.12, 128 MB, timeout 5 segundos; logs con retención de 14 días. Con ruta GET técnica pública en el API administrativo existente; sin Function URL, acceso a datos ni secretos. Ver procedimiento de empaquetado, despliegue y verificación en Administración.
