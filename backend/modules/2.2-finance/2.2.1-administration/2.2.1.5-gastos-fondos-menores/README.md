# Gastos y fondos menores

Responsabilidad general: Organizar gastos operativos, caja chica, anticipos y rendiciones.

Estado: pendiente de implementación.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

## Submódulos

- [Gastos operativos](2.2.1.5.1-gastos-operativos/README.md)
- [Caja chica](2.2.1.5.2-caja-chica/README.md)
- [Anticipos y rendiciones](2.2.1.5.3-anticipos-rendiciones/README.md)

## Diagnóstico técnico DEV

Función: `mastererp-dev-adm-gastos`. Estado funcional: pendiente de implementación; el handler mínimo no implementa operaciones de gastos. Código en [handler.py](lambdas/mastererp-dev-adm-gastos/handler.py). Python 3.12, 128 MB, timeout 5 segundos; logs con retención de 14 días. Con ruta GET técnica pública en el API administrativo existente; sin Function URL, acceso a datos ni secretos. Ver procedimiento de empaquetado, despliegue y verificación en Administración.
