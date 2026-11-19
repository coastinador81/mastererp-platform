# Proveedores conectados en Finanzas DEV

La entrega sustituye el borrador sin conexión por el listado y formulario existentes de `Parties.jsx`, con campos ampliados reutilizables en `SupplierFields.jsx`. La entrada es https://finanzas-dev.uonify.com/?vista=proveedores. Exige login Cognito y contexto autorizado de tenant/empresa. No hay proveedores ficticios locales ni un fallback que simule guardado. Los registros DEMO se cargan explícitamente en PostgreSQL, no en el bundle frontend.

## Recorrido y campos

Al dar de alta un proveedor nuevo, el formulario muestra un código interno inhabilitado. Consulta la propuesta con `GET /v1/administration/proveedores?company_id=<uuid>&proponer_codigo=1`. Esta lectura no reserva el código. El formulario envía el alta sin `codigo` y la API devuelve el código definitivo asignado en PostgreSQL. Se usa la serie `PROV-0001` por tenant y se conservan los códigos previos. El enlace a una ficha existente reutiliza su código. El mismo proveedor queda disponible en Compras cuando está activo y asociado a la empresa.

El menú Administración → Gestión de compras → Proveedores abre primero el listado real, con Crear proveedor. Incluye detalle, creación, edición, paginación y conflictos de versión. Las URLs de lista, crear, detalle y editar usan parámetros en la raíz; soportan recarga y atrás/adelante. PKCE conserva solo la ruta lógica mediante el contrato existente, sin tokens en la URL. La portada permanece en / y no vuelve el bloque promocional retirado.

| Bloque | Campos |
| --- | --- |
| Generales | Código, razón social/nombre, nombre comercial, tipo de persona |
| Fiscales | País fiscal, tipo y número de identificación |
| Dirección | Dirección, complemento, ciudad, municipio, estado/provincia, código postal y país |
| Comunicación | Correo, teléfono principal y alternativo, sitio web |
| Contactos | Nombre, cargo, correo, teléfono y principal; hasta diez contactos |
| Comerciales por empresa | Tipo de suministro (productos, servicios o ambos), moneda preferida, condición/medio de pago, plazo, descuento y plazo de pronto pago |
| Observaciones | Notas internas |

Para un proveedor nuevo, el nombre es el único campo obligatorio que completa la persona. El resto se completa progresivamente. No se validan identificaciones ante organismos fiscales ni se conceden créditos, calculan impuestos, ejecutan compras o transfieren fondos al registrar preferencias. No se imponen tasas ni descuentos predeterminados.

## Modelo, autorización y alineación

La migración propia se concilió como 032 sobre 001–031 de dev, conservando el trabajo de Andrea. Código/nombre/versión pertenecen a catalogo.terceros; los datos fiscales, de dirección y contacto reutilizan catalogo.proveedores_catalogo.contacto de 024, bajo el mismo tercero_id. No se crea otro maestro ni se duplica contacto en terceros. Los campos desconocidos de contacto se preservan. El segundo rol cliente referencia ese mismo tercero. Las condiciones negociadas por empresa utilizan el perfil administrativo y las entidades existentes de condiciones y pronto pago; no sobrescriben defaults de Catálogo.

La API HTTP administrativa existente usa mastererp-dev-adm-clientes y mastererp-dev-adm-proveedores y el secreto de mastererp_app, con TLS y contexto local a la transacción. Mantiene permisos y overrides, módulos, pertenencia/usuario/tenant/empresa activos. Las funciones v2 no conceden DML general y conservan v1. La creación usa Idempotency-Key y huella de todo el contenido; la edición usa version, profile_version y catalog_version. Un cambio concurrente desde Catálogo también debe producir conflicto. Auditoría y logs no contienen los datos de la ficha.

No se añade DELETE. La eliminación o archivo de un proveedor con relaciones financieras necesita su regla funcional y no se resuelve borrando maestros. La presente capacidad comprende crear, leer y actualizar. La ficha no persiste datos sensibles en localStorage; la sesión y permisos nunca se simulan para mostrar registros reales.

## Tumandaito y pruebas

Tumandaito es un tenant business propio y contiene su empresa Tumandaito (VE, VES, America/Caracas). El propietario fue indicado expresamente; se vinculó por issuer+sub de Cognito y recibió una invitación solicitada por el propietario del proyecto. No se asocian usuarios internos automáticamente por correo ni se asignan cuentas QA a Tumandaito. El primer acceso del propietario requiere cambiar la contraseña temporal; nunca se registra en Git o consola.

Los ocho proveedores de ejemplo se identifican como DEMO-PROV-001..008, contienen nombres DEMO, contactos example.invalid e identificaciones sin validez fiscal. La carga usa el migrador oficial, transacción como mastererp_app y claves idempotentes; no sobrescribe proveedores existentes ni genera deudas, pagos o inventario. La confirmación de carga y resultados reales se registra al finalizar la validación.

Pruebas locales: build Vite, tests de rutas y autenticación Node, tests del adaptador Python, validadores y diff --check. El Docker instalado no tiene motor Linux disponible; no se declara PostgreSQL desechable aprobado. El candidato SQL corregido se validó en RDS con ROLLBACK antes de la aplicación oficial. `scripts/validate_suppliers_dev.cjs` prueba servicios DEV reales con actores sintéticos existentes y tenants QA nuevos; limpia solo sus fixtures, conservando Tumandaito. No confundir estas pruebas con el primer acceso real del propietario.

La publicación frontend usa Publish Finance frontend DEV con OIDC. Las Lambdas se empaquetan con scripts/package_parties.py y se actualizan por el stack Finanzas → Administración mediante Infrastructure/scripts/deploy_parties.py. No se reimporta el API ni se modifican rutas, JWT, CORS o el hosting de Uonify.

## Resultado verificado

Publicación frontend 37f2412 y backend 9952628; actualización del stack propietario con Infrastructure 8cea82f. Database 032 aplicada/reaplicada y probada en [el workflow oficial](https://github.com/eticayservicios/mastererp-database/actions/runs/41898487786). Los ocho registros DEMO de Tumandaito quedaron creados como mastererp_app; las pruebas QA son independientes y no los limpian.

[Diecisiete escenarios reales aprobados](supplier-evidence/validation.json), incluidos UI de alta/edición y lectura independiente por API, idempotencia, tres versiones, carreras 201+200/200+409, doble rol, contexto y guardas 401/403/404. Se verificaron seis eventos de negocio y la limpieza QA. [Captura del listado QA](supplier-evidence/suppliers-live-desktop.png); solo contiene datos sintéticos de las fixtures ya retiradas, no datos del propietario de Tumandaito. Se conservaron los IDs y configuración de ocho funciones; solo cambió el código previsto de Clientes/Proveedores, sin cambios de rutas, integraciones, JWT o CORS.

Las suites locales aprobaron ocho pruebas Python del adaptador, ocho Node de rutas/autenticación, cinco de proyección de plantillas y tres de fallo cerrado del migrador. Validadores y diff --check aprobados. El primer acceso del propietario real tras la invitación requiere su cambio de contraseña y no se declara ejecutado por estas pruebas. Borrado/archivo, datos bancarios y operaciones de Compras siguen fuera de esta entrega.
