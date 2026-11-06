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
