# Clientes

Responsabilidad general: Gestionar la relación administrativa con clientes utilizando el maestro existente, sin duplicarlo.

Estado: pendiente de implementación.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

Maestro de clientes: no se encontró una ubicación o contrato explícito en los repositorios revisados. Identificar y referenciar el maestro existente antes de implementar; esta carpeta no crea un maestro nuevo ni asigna su propiedad a MasterCRM.

## Diagnóstico técnico DEV

Función: `mastererp-dev-adm-clientes`. Estado funcional: pendiente de implementación; el handler mínimo no implementa operaciones de clientes. Código en [handler.py](lambdas/mastererp-dev-adm-clientes/handler.py). Python 3.12, 128 MB, timeout 5 segundos; logs con retención de 14 días. Con ruta GET técnica pública en el API administrativo existente; sin Function URL, acceso a datos ni secretos. Ver procedimiento de empaquetado, despliegue y verificación en Administración.
