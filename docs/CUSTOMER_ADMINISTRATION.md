# Clientes: ficha administrativa común

La identidad de tercero (código/nombre), los datos fiscales y el contacto
administrativo se comparten entre Cliente y Proveedor dentro del tenant.
Condiciones comerciales por empresa y rol. No crear un proveedor para un cliente.

GET/POST/PATCH /v1/administration/clientes conservan sus contratos básicos y
aceptan datos_generales, contactos y condiciones con las validaciones existentes.
PATCH incluye version, catalog_version cuando cambia contacto y profile_version
cuando cambia condiciones. POST mantiene Idempotency-Key y huella del contenido.
Depende de 044 en Database antes de desplegar el backend y publicar el formulario.

Listado paginado/búsqueda y ficha muestran datos reales. Referencia eCommerce solo
consulta correo de cuenta/teléfono del canal; no modifica login ni sus direcciones.
Cognito autentica y PostgreSQL autoriza cada operación. Contexto, overrides,
idempotencia y sincronización de código permanecen. No se añaden rutas ni permisos.

Saldos, vencimientos, anticipos, facturas/cobros y límites de crédito aún no están
conectados en esta ficha. Se indican pendientes sin cifras o aprobaciones ficticias.
El alta/edición administrativa sí debe validarse con persistencia real por API.

Empaquetado: scripts/package_parties.py --capabilities clientes. Reutilizar el
paquete publicado de Proveedores al preparar el despliegue compartido, revisando
que solo Clientes cambie código en Finanzas/Administración. No tocar Compras.

## Resultado real en DEV — 6 de noviembre de 2026

044 aplicada/reaplicada: https://github.com/eticayservicios/mastererp-database/actions/runs/42283586504
045 lectura legacy sin backfill: https://github.com/eticayservicios/mastererp-database/actions/runs/42284711153
Frontend: https://github.com/eticayservicios/mastererp-platform/actions/runs/42285586530
Snapshot previo mastererp-dev-before-customer-admin-044-20261106 disponible.
Se corrigió el teléfono de una fixture para cumplir el contrato existente de
Storefront; los preflight fallidos no confirmaron esquema. Sin ampliar permisos.

19 casos HTTP reales aprobados: alta sin proveedor, datos/condiciones persistidos,
lectura independiente, replay y conflicto, doble rol sin duplicar, edición común,
versiones y cambio de código/contactos con un incremento de Catálogo, condiciones
separadas, edición Catálogo conservando fiscales, carreras 201/200 y 200/409,
sin token 401, empresa ajena/override/módulo deshabilitado 403. Limpieza confirmada.

Siete casos de navegador DEV aprobados: login autorizado, alta, consulta API
independiente, edición/contacto, tarjetas sin alturas heredadas, recarga y móvil. Evidencia sanitizada en
[HTTP](customer-admin-evidence/http-validation.json) y
[navegador](customer-admin-evidence/browser-validation.json).
Cinco escenarios locales de frontend con fixtures y build aprobados; no se
presentan como pruebas de persistencia. Backend/SQL se validaron en AWS.

Solo cambió el paquete de mastererp-dev-adm-clientes, Active/Successful;
CodeSha256 sCS4N5Qcb5GT1DXmJThY6kfX4xZ/qKdCrtsCs7umgUY=.
Proveedores conserva exactamente su paquete anterior:
59gddtuynKF17p1qzzm+EaMDSDckm0oSRo+BKTEvvbM=.
Finanzas y Administración UPDATE_COMPLETE, sin recursos nuevos/reemplazos,
ni cambios de API, CORS, Cognito, configuración de RDS, Compras, Contabilidad o BI.

Alcance cerrado: ficha administrativa CRUD, listado/búsqueda paginada y lectura
mínima del canal. No se declara cerrado el circuito financiero ni checkout de
Storefront por estas pruebas. Crédito/límites, saldos/documentos/cobros siguen
pendientes de operaciones reales y reglas priorizadas. No se aplican porcentajes
ni aprobaciones automáticamente, ni se vinculan identidades por correo.

La proyección de lectura 045 también se aplicó/reaplicó con seis suites SQL aprobadas. La corrección visual queda limitada a customer-view; no modifica los CSS globales de Operaciones ni Compras.
