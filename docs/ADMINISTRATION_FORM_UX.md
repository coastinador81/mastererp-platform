# Formularios guiados de Administración

Fuente oficial: Platform/dev. Leer junto con [README de Finanzas](../frontend/modules/2.2-finance/README.md) y [arquitectura frontend](FRONTEND_ARCHITECTURE.md). Los README propietarios enlazan esta guía, sin mantener variantes contradictorias.

## Patrón compartido

Una etapa por interfaz, con indicador de tres pasos, título y explicación breve. Anterior conserva datos; Continuar valida los campos visibles. La confirmación aparece únicamente al final. La tarjeta ocupa el ancho disponible del contenido sin tapar el menú; en móvil los campos se apilan. Mantener Inter, superficies blancas, fondo gris azulado, acentos azules y foco visible.

| Crear | Paso 1 | Paso 2 | Paso 3 | Confirmación |
| --- | --- | --- | --- | --- |
| Proveedor | Datos básicos e identificación fiscal | Dirección, comunicación y contactos | Condiciones de empresa y revisión | Crear proveedor |
| Cliente | Datos básicos e identificación fiscal | Dirección, comunicación y contactos | Condiciones de empresa y revisión | Crear cliente |
| Orden de compra | Solicitud origen y datos de la orden | Detalles | Revisión de cabecera y líneas | Guardar borrador |

Los pasos reflejan los contratos existentes, sin añadir requisitos funcionales. Editar conserva el formulario completo actual; Solicitudes y Facturas no cambian de presentación.

## Garantías

- Cambiar de paso no escribe por API. Solo confirmar utiliza la operación existente, conservando permisos, contexto, versión e Idempotency-Key. Reintentar el mismo contenido conserva su clave.
- Contactos opcionales, sin registros ficticios ni principal automático. Validar contactos parciales y conservar datos capturados ante errores.
- Un error de guardado no vacía el formulario. No resolver conflictos sobrescribiendo cambios ajenos. Cambiar contexto conserva los mecanismos existentes de cancelación y limpieza.
- Datos comunes del tercero siguen compartidos por tenant; las condiciones conservan su alcance por empresa y rol. La UX no modifica persistencia ni autorización.
- Órdenes se guardan como borrador: no se aprueban, emiten, contabilizan ni mueven inventario o crean obligaciones por este recorrido. Los totales confirmados corresponden al backend; la revisión no inventa cálculos.
- El encabezado enfoca el título del paso y anuncia el progreso. Conservar etiquetas y teclado, estados de carga/error y diseño responsive.

## Reutilización y responsabilidades

`frontend/modules/2.2-finance/2.2.1-administration/screens/parties/SupplierWizardHeader.jsx` es compartido pese a su nombre histórico: admite variantes proveedor, cliente y orden. `supplierWizard.css`, en la misma carpeta, delimita estilos con `.finance-app .supplier-create-wizard` para evitar interferencias entre módulos.

Clientes y Proveedores reutilizan `Parties.jsx` y sus campos actuales. Órdenes reutiliza `2.2.1.2-gestion-compras/screens/purchases/PurchaseForm.jsx`; solo la creación de órdenes activa el asistente. No duplicar pantallas ni reconstruir operaciones para aplicar esta apariencia.

Desarrolladores e IA deben consultar esta guía antes de modificar formularios administrativos y actualizar el README propietario al cambiar el recorrido. Revisar consumidores y coordinar cambios compartidos, incluido el trabajo en Compras. El Product Owner define reglas funcionales pendientes; una referencia visual no autoriza inventarlas.

## Estado y validación

Candidato local: Clientes y Órdenes siguen el patrón existente de Proveedores. Esto no acredita despliegue ni persistencia en DEV.

Pruebas reproducibles: `node scripts/validate_supplier_wizard_local.cjs`, `node scripts/validate_customer_admin_local.cjs`, `node scripts/validate_order_wizard_local.cjs`. Son pruebas de navegador con fixtures locales, sin peticiones a AWS ni RDS. Ejecutar además build de Finanzas, validador estructural y `git diff --check`. Antes de publicar, revisar el commit y los paths del pipeline: cambios frontend pueden desplegar Finanzas automáticamente.
