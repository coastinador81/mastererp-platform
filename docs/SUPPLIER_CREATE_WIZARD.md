# Alta de Proveedores en tres pasos

Ruta DEV: https://finanzas-dev.uonify.com/?vista=proveedores&accion=crear

1. Identidad: código interno, nombre y datos fiscales.
2. Dirección, comunicación y contactos opcionales, sin principal automático.
3. Condiciones de la empresa activa, observaciones y revisión.

Anterior conserva lo capturado; Continuar valida los campos visibles. Solo Crear
proveedor al final envía el POST vigente con su clave de idempotencia. Un error
no elimina el borrador en memoria. Recargar la página sí reinicia el alta.
Sin cambios de API, SQL, permisos, Clientes o Compras. Editar conserva su formulario.
Datos generales/contactos compartidos entre empresas del espacio; condiciones
comerciales específicas de empresa. Fuente técnica: Administración/screens/parties.

Validación local: siete escenarios en Chrome con fixtures y respuestas simuladas,
build Vite, estructura y diff --check. No equivale a persistencia real DEV.
Ejecutar scripts/validate_supplier_wizard_local.cjs con Playwright ya disponible
mediante MASTERERP_PLAYWRIGHT_MODULE; no añade dependencia al producto.
Publicación mediante Publish Finance frontend DEV en dev.
