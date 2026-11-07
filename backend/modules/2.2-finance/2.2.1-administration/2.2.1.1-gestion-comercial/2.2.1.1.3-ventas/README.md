# Ventas

Responsabilidad general: Organizar la gestión administrativa de las ventas.

Estado: pendiente de implementación.

Propietario funcional: Finanzas → Administración; responsable nominal pendiente de asignación.
Dependencias: contexto autorizado de tenant y contratos del padre; reglas y criterios de aceptación se definirán con el Product Owner al priorizar la tarea.

## Diagnóstico técnico DEV

Función: `mastererp-dev-adm-ventas`. Estado funcional: pendiente de implementación; el handler mínimo no implementa operaciones de ventas. Código en [handler.py](lambdas/mastererp-dev-adm-ventas/handler.py). Python 3.12, 128 MB, timeout 5 segundos; logs con retención de 14 días. Con ruta GET técnica pública en el API administrativo existente; sin Function URL, acceso a datos ni secretos. Ver procedimiento de empaquetado, despliegue y verificación en Administración.


## Listado y ficha — candidato de consulta

La Lambda existente mastererp-dev-adm-ventas conserva /health y prepara GET /v1/administration/ventas y GET /v1/administration/ventas/{id}. Reutiliza identidad issuer+sub y application_connection(write=False), mastererp_app y SSL; requiere administration.read y erp.finance habilitado en el tenant/empresa. No hay comandos de escritura en esta API.

Consulta SQL: administracion.ventas_leer de la migración nueva 048, con búsqueda servidor y cursor estable de creación descendente. Cabecera, cliente histórico, pedido y líneas salen de los registros oficiales; dinero/cantidades viajan como strings decimales. Campos query: company_id obligatorio, limit 1..100, after UUID y q hasta 120 caracteres. Tenant por X-MasterERP-Tenant-Id y JWT con scope vigente identity.spaces.read. Sin saldos/pagos/facturación simulados. El workflow Validate Sales read API prueba y empaqueta en Linux remoto; la publicación AWS debe pasar por Finanzas → Administración, sin recrear API ni Lambda.

Estado de este apartado: candidato local; registrar validaciones y despliegue antes de declararlo disponible.
