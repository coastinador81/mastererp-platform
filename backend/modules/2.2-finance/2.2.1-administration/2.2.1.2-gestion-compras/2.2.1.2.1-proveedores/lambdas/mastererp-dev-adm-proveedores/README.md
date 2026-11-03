# mastererp-dev-adm-proveedores

Diagnóstico técnico DEV: devuelve HTTP 200 y JSON status=ok con su nombre. Python 3.12, sin dependencias externas, lógica de negocio, autenticación propia, acceso a datos ni llamadas de red. Invocación IAM y ruta GET técnica pública por API Gateway; sin Function URL.

Código propietario: este handler. Infraestructura: mismo módulo funcional en mastererp-infrastructure, resources.yml raíz; sin YAML por Lambda. Empaquetado y pruebas: scripts/package_administration.py desde la raíz de Platform. Despliegue y verificación: ADMINISTRATION_LAMBDAS_DEV.md del módulo Administración en Infrastructure. Ruta: GET /v1/administration/proveedores/health, API qx8nmypdhi. El propietario solicitó explícitamente acceso público al diagnóstico; JWT pendiente para futuras capacidades funcionales.

## Capacidad funcional de terceros

Se implementan listado paginado, detalle, creación idempotente y actualización versionada mediante el maestro de terceros y perfiles por empresa (SQL 014). La sección de diagnóstico anterior describe la fase histórica; /health se conserva. Contrato vigente: docs/ADMINISTRATION_PARTIES.md en la raíz de Platform. Sin frontend ni fiscalidad.
