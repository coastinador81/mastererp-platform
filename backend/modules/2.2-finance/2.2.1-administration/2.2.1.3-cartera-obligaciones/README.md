# Cartera y obligaciones

Responsabilidad general: Organizar los saldos pendientes de cobro y las obligaciones de pago.

Estado: pendiente de implementación.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

## Submódulos

- [Cuentas por cobrar](2.2.1.3.1-cuentas-por-cobrar/README.md)
- [Cuentas por pagar](2.2.1.3.2-cuentas-por-pagar/README.md)

## Diagnóstico técnico DEV

Función: `mastererp-dev-adm-cartera`. Estado funcional: pendiente de implementación; el handler mínimo no implementa operaciones de cartera. Código en [handler.py](lambdas/mastererp-dev-adm-cartera/handler.py). Python 3.12, 128 MB, timeout 5 segundos; logs con retención de 14 días. Sin API Gateway, Function URL, acceso a datos ni secretos. Ver procedimiento de empaquetado, despliegue y verificación en Administración.
