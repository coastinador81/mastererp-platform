# mastererp-dev-adm-clientes

Estado: capacidad funcional desplegada en DEV, con listado paginado, detalle, creación idempotente y actualización versionada. Las pruebas HTTP demuestran persistencia y autorización con mastererp_app; no hay frontend ni fiscalidad.

Python 3.12 arm64, 256 MB, timeout 15 segundos. Driver pg8000, CA de RDS, secreto de aplicación y subnets/SG privados existentes. Rutas funcionales JWT bajo /v1/administration/clientes; GET /health conserva el diagnóstico técnico público sin acceso a datos.

Código propietario: handler.py y el adaptador compartido exclusivo de Administración. Contrato y ejemplos: docs/ADMINISTRATION_PARTIES.md en Platform. Empaquetado: scripts/package_parties.py. Infraestructura en resources.yml raíz de la carpeta funcional y despliegue mediante scripts/deploy_parties.py en Infrastructure (Finanzas → Administración). No usar el empaquetador genérico histórico de ocho diagnósticos para esta función.

Evidencia y límites: docs/ADMINISTRATION_PARTIES_DEV.md en Database. La implementación inicial solo devolvía health 200; esa fase histórica ya no describe las rutas funcionales.
