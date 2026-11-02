# mastererp-dev-adm-tesoreria

Diagnóstico técnico DEV: devuelve HTTP 200 y JSON status=ok con su nombre. Python 3.12, sin dependencias externas, lógica de negocio, autenticación propia, acceso a datos ni llamadas de red. Solo invocación IAM; sin Function URL ni API Gateway.

Código propietario: este handler. Infraestructura: mismo módulo funcional en mastererp-infrastructure, resources.yml raíz; sin YAML por Lambda. Empaquetado y pruebas: scripts/package_administration.py desde la raíz de Platform. Despliegue y verificación: ADMINISTRATION_LAMBDAS_DEV.md del módulo Administración en Infrastructure. La autenticación HTTP no está implementada porque no se publica una ruta.
