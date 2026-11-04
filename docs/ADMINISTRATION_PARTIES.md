# Clientes y Proveedores DEV

Estado de implementación: desplegado y validado en DEV; evidencias de publicación y HTTP en Database/docs/parties-dev-validation.json y informes de validación asociados. El primer recorrido UI se registra por separado en [FINANCE_UI_INTEGRATION.md](FINANCE_UI_INTEGRATION.md); no se añaden reglas fiscales.

## Modelo y autorización

Se reutiliza catalogo.terceros por tenant, catalogo.roles_tercero y administracion.perfiles_tercero por empresa/rol. Codigo es único por tenant y no se interpreta como identificador fiscal. Crear con tercero_id añade un perfil al mismo maestro; nunca copiar la entidad para el segundo rol. Nombre/código/version pertenecen al maestro compartido: actualizar cambia los perfiles de sus empresas; se exige permiso en todas las empresas vinculadas y se deniega si alguna no está activa. No se inventa una ACL de empresa por usuario; se conserva la contención tenant/empresa del contrato 007.

JWT Cognito verificado por API Gateway; issuer + sub resuelve el usuario interno. Se conserva el scope mastererp-dev/identity.spaces.read como acceso coarse al API; no sustituye permisos. PostgreSQL exige erp.finance activo, actor/tenant/pertenencia activos y administration.parties.read/write con overrides de denegación prevalentes. tenant.owner recibe las dos concesiones solo al crear los nuevos permisos; una reaplicación no restablece concesiones retiradas. Miembros sin ellas no acceden.

Conexión nueva por solicitud con secreto de mastererp_app y TLS verify-full. Contexto SET LOCAL, transacción read-only para GET y atómica para escrituras; rollback y cierre garantizados. El adaptador compartido conserva read-only como valor predeterminado de los consumidores existentes. No hay DML directo adicional: solo EXECUTE de las funciones controladas de 014.

## Contrato

API DEV: https://qx8nmypdhi.execute-api.us-west-1.amazonaws.com. Bases /v1/administration/clientes y /v1/administration/proveedores. GET /health técnico se conserva sin datos. Todas las rutas nuevas exigen JWT/scope y cabecera X-MasterERP-Tenant-Id.

| Operación | Método/ruta relativa a la base | Entradas |
| --- | --- | --- |
| Listar | GET / | company_id, limit 1–100 (25 por defecto), after UUID opcional en query |
| Detalle | GET /{tercero_id} | company_id en query |
| Crear maestro/perfil | POST / | JSON company_id, codigo, nombre; Idempotency-Key obligatoria |
| Añadir rol o empresa al maestro | POST / | JSON company_id, tercero_id; Idempotency-Key obligatoria |
| Actualizar maestro | PATCH /{tercero_id} | JSON company_id, codigo, nombre, version entera vigente; ambos campos requeridos |

La base no lleva slash final. Respuestas: data y correlation_id; listado data.items/next_cursor. La versión es global al tercero, no al perfil. Creación 201; replay 200 con replayed=true y la respuesta original; conflicto de contenido/duplicado o versión obsoleta 409; sin token 401; denegación 403; detalle no visible 404; entrada inválida 400; indisponibilidad 503 sanitizada. Campos desconocidos se rechazan.

Ejemplo POST clientes: {"company_id":"<uuid>","codigo":"QA-001","nombre":"Cliente de prueba"}. Para convertirlo también en proveedor, POST proveedores con {"company_id":"<mismo uuid>","tercero_id":"<id devuelto>"}. PATCH clientes/<id>: {"company_id":"<uuid>","codigo":"QA-001","nombre":"Nombre actualizado","version":1}.

Idempotencia: almacén compartido, clave interna derivada de actor/tenant/operación/clave externa; huella calculada por PostgreSQL incluye empresa, rol y contenido relevante. La respuesta original se conserva en response_payload. Misma clave con otra empresa/contenido produce conflicto. Bloqueo transaccional serializa la clave y la mutación del maestro por tenant; requiere afinarse con evidencia antes de cargas elevadas. Escritura y auditoría se confirman juntas. Auditoría de escritura en events; lecturas y denegaciones en logs de esquema fijo, sin nombres, códigos, tokens ni cuerpos.

## Empaquetado

py scripts/package_parties.py --dependencies <dependencias Python existentes> --output <artefactos>. Driver pg8000 puro Python compatible con arm64/Linux. Se empaquetan los dos handlers existentes, parties.py exclusivo de Administración, tenant_security y bundle CA; sin secretos. El empaquetador genérico anterior es histórico para diagnósticos y no debe desplegar estas dos funciones.

Infraestructura y despliegue: mastererp-infrastructure/scripts/deploy_parties.py; API en su propietario actual Onboarding, funciones/rutas en el hijo Administración, actualizado mediante Finanzas. No invocar directamente un update del stack hijo. Recuperación: preservar ZIP/plantillas previos y revisar change set inverso; SQL se corrige hacia delante, no se revierte borrando datos.

## Resultado verificado DEV

Desplegado: 33 comprobaciones HTTP funcionales aprobadas, con persistencia, idempotencia, versiones, permisos, aislamiento y limpieza acotada. Evidencia principal en Database/docs/ADMINISTRATION_PARTIES_DEV.md y parties-http-validation.json. Se documentan aparte los tres 403 previos de Uonify y la incidencia de reimportación SAM recuperada con nuevos IDs de rutas/integraciones. Las ocho Lambdas conservaron sus IDs y las otras seis su código.

## Extensión de Proveedores conciliada con 032

El adaptador actualizado usa parties_read_v2 y party_write_v2; v1 permanece compatible. POST/PATCH de proveedores aceptan opcionalmente datos_generales (objeto cerrado), contactos (hasta diez y un principal como máximo) y condiciones (preferencias y plazos). PATCH con datos generales/contactos exige catalog_version; con condiciones exige profile_version; version del maestro siempre se conserva. GET añade esos objetos y catalog_version/catalog_status. Clientes mantiene su contrato de escritura básico; si comparte tercero con un proveedor, la lectura puede reflejar sus datos comunes. No se admite la extensión en escrituras de cliente para no crear perfiles de proveedor ficticios.

El JSON de contactos canónico de Catálogo es la fuente compartida, no una copia nueva en terceros. Administrar condiciones por empresa no otorga acceso a otros módulos ni sustituye sus permisos. Las condiciones del perfil se versionan usando las entidades existentes, sin alterar ediciones ya acordadas. Una modificación de Catálogo invalida catalog_version. Los bloqueos mantienen el orden proveedor canónico → maestro para evitar invertir el orden de sus comandos existentes.

Ver [ficha y recorrido conectado](SUPPLIER_FORM_DEV.md). Los datos fiscales y contactos no se escriben en logs ni metadatos de auditoría. La huella de idempotencia incluye todo el JSON nuevo y conserva el replay histórico de las solicitudes básicas sin extensión. No hay DELETE ni cambios de rutas/seguridad del API en esta entrega.
