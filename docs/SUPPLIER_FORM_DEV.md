# Ficha visual de proveedores DEV

Alcance solicitado: ampliar los datos recomendados durante el desarrollo visual sin conexión. La entrada es `https://finanzas-dev.uonify.com/?vista=proveedores`; el menú Administración → Gestión de compras → Proveedores abre primero un listado visual con Código, Razón social o nombre, Identificación fiscal, Correo y Teléfono. El botón Crear proveedor abre `?vista=proveedores&accion=crear`, sin autenticación para editar únicamente un borrador en memoria. El listado indica que está pendiente de conexión; no se presenta como una consulta vacía real ni contiene proveedores ficticios. La ficha vuelve al listado mediante Volver a Proveedores. No consulta proveedores existentes, no muestra datos reales y no guarda en el servidor ni en almacenamiento del navegador. Recargar o salir descarta el borrador. La interfaz lo indica y usa Revisar ficha, nunca un mensaje ficticio de guardado.

## Datos incluidos

| Bloque | Campos |
| --- | --- |
| Generales | Código interno, razón social o nombre, nombre comercial, tipo de persona |
| Fiscales | País fiscal, tipo y número de identificación |
| Dirección | Dirección, complemento, ciudad, municipio, estado/provincia, código postal, país |
| Comunicación | Correo principal, teléfono principal, teléfono alternativo, sitio web |
| Personas de contacto | Nombre, cargo, correo, teléfono y contacto principal; añadir/quitar hasta diez contactos por ficha |
| Comerciales | Moneda preferida, condición y medio de pago, plazo en días, descuento y plazo de pronto pago |
| Observaciones | Notas internas |

Solo código y nombre son obligatorios, conforme al maestro existente. Los límites de texto y de contactos son límites técnicos de esta vista. Los demás datos se completan progresivamente; no se imponen reglas fiscales, tasas, condiciones de crédito ni descuentos predeterminados. País/moneda usan códigos en mayúsculas de dos/tres letras, sin acreditar que existan en los catálogos. Identificación fiscal no se valida contra organismos externos. Se validan formatos de correo/URL y valores no negativos de días y porcentaje entre cero y cien; descuento y plazo se capturan juntos. Esto no calcula obligaciones, concede crédito, ejecuta pagos ni altera libros fiscales.

## Correspondencia y persistencia pendientes

`SupplierDraft.jsx` vive en la pantalla compartida existente `frontend/modules/2.2-finance/2.2.1-administration/screens/parties/`. No se crea otra carpeta funcional ni otro maestro. Código y nombre ya pertenecen a `catalogo.terceros`; los datos generales/fiscales y contactos deberán ampliarse sobre ese mismo maestro sin duplicar cliente/proveedor. Las condiciones comerciales son de empresa/perfil y deben integrarse con `administracion.perfiles_tercero`, `condiciones_comerciales` y `descuentos_pronto_pago`, conservando sus versiones y relaciones. Los nombres de campos del borrador son de presentación y todavía no amplían el contrato API.

El formulario funcional `Parties.jsx` y sus comandos SQL existentes conservan su contrato actual. Esta entrega no envía los campos nuevos a una API que todavía los rechaza. No hay migración ni cambios de Lambda, permisos, RLS, recursos o Database. La restauración automática de sesión se omite únicamente en esta vista de borrador; no se sustituye ni simula una identidad. Los flujos autenticados y callback existentes mantienen su tratamiento.

Antes de persistir estos campos habrá que implementar una migración nueva, autorización del maestro compartido y del perfil de empresa, contratos API, idempotencia sobre todo el contenido relevante, versión, auditoría sin datos sensibles y pruebas de aislamiento. Datos bancarios, adjuntos, reglas tributarias y aprobaciones quedan fuera del alcance recomendado de esta ficha. El Product Owner concretará requisitos fiscales y comerciales al priorizar esas operaciones.

## Build y pruebas

Desde Platform: `npm --prefix frontend/modules/2.2-finance run build`, `python scripts/validate_structure.py` y `git diff --check`.

Prueba de navegador local: `node scripts/test_supplier_draft.cjs`, con Playwright disponible mediante `MASTERERP_PLAYWRIGHT_MODULE` y Chrome mediante `MASTERERP_CHROME_PATH` cuando corresponda. El test usa un servidor local del build, datos sintéticos en memoria y bloquea conexiones externas; comprueba campos, errores, revisión, contactos, edición, responsive y descarte al recargar. No usa credenciales ni fixtures RDS. La publicación DEV corresponde al workflow existente Publish Finance frontend DEV; Uonify no observa estas fuentes.
