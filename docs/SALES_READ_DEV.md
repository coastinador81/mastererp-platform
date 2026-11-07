# Ventas: listado y detalle en DEV

Responsabilidad: Finanzas → Administración → Gestión comercial → Ventas. Pantallas únicas bajo `frontend/modules/2.2-finance/2.2.1-administration/2.2.1.1-gestion-comercial/2.2.1.1.3-ventas/screens/list` y `screens/detail`, compartidas por los builds actuales de Finanzas y App Shell. No se copian pantallas ni se añade un microfrontend.

Entrada independiente: https://finanzas-dev.uonify.com/?vista=ventas. Detalle: `?vista=ventas&id=<uuid>`. Recarga, atrás/adelante, teclado y nueva pestaña conservan la ruta. El menú exige `administration.read`, además del módulo `erp.finance`; la API vuelve a autorizar cada lectura. No se asignaron roles a usuarios reales ni se sustituyó el rol propietario de ningún tenant.

API existente `mastererp-dev-admin-api` (`qx8nmypdhi`): GET `/v1/administration/ventas` y GET `/v1/administration/ventas/{id}`. JWT Cognito y `X-MasterERP-Tenant-Id`; `company_id` obligatorio; `limit` 1–100, `after` UUID y `q` hasta 120 caracteres. Listado: `data.items` y `data.next_cursor`; detalle: `data.lineas`. Dinero y cantidades son cadenas decimales. La ficha usa nombre histórico del cliente y pedido de origen; no representa factura, cobro ni saldo.

Backend: Lambda existente `mastererp-dev-adm-ventas`, paquete Linux remoto de Platform `1ec28f3`. Runtime Python 3.12, 256 MB, timeout 15 s. SQL: `administracion.ventas_leer`, migración 048, `mastererp_app`, conexión SSL y contexto transaccional. Sin comandos de escritura en esta API; health permanece como diagnóstico técnico público mínimo.

## Verificaciones ejecutadas

- AWS DEV: 048 aplicada y reaplicada mediante [Apply DEV database model](https://github.com/eticayservicios/mastererp-database/actions/runs/42324367060), tras preflight y snapshot disponible. Suites SQL 048, 047 y 046 aprobadas bajo `SET ROLE mastererp_app`; solo 048 se confirmó, sin reaplicar migraciones anteriores.
- Backend: [Validate Sales read API](https://github.com/eticayservicios/mastererp-platform/actions/runs/42323887430), siete pruebas y empaquetado Linux remoto aprobados.
- Infraestructura: change sets padre/anidado revisados y ejecutados sin reemplazos/eliminaciones; IDs físicos, rutas anteriores y CORS conservados. Stack propietario: `mastererp-dev-finance` → `mastererp-dev-administration`.
- HTTP real DEV: veinte casos aprobados: listado, tres páginas, detalle persistido, búsqueda, vacío, empresa vacía, aislamiento de detalle/cursor, empresa/tenant/actor ajenos, proxy autorizado y sin token, override denegado, módulo deshabilitado, pertenencia inactiva, recuperación de contexto y health. Se reutilizaron tres ventas sintéticas selladas; no cambió el historial ni sus auditorías de escritura. Los tenants QA quedaron suspendidos.
- Navegador local: once casos con respuestas sintéticas exclusivamente en el harness: listado, búsqueda servidor, paginación, enlaces nativos, fila, selección de texto, recuperación de error, cambio de empresa, pérdida de permiso, escritorio/móvil y precisión decimal. Esto no acredita una sesión completa en el navegador desplegado.
- Build de Finanzas, siete pruebas de rutas, validador estructural y `git diff --check` aprobados antes de publicación.

## Reproducción y entrega

Frontend: `npm run build` desde `frontend/modules/2.2-finance`. La publicación en dev la realiza `publish-finance-dev.yml`; los cambios de App Shell son consumidores compartidos y también siguen su pipeline vigente. Para revertir la interfaz, publicar el commit anterior revisado por el mismo mecanismo; no borrar recursos ni datos.

Prueba visual local: `node scripts/validate_sales_local.cjs`, con `MASTERERP_PLAYWRIGHT_MODULE` apuntando al Playwright ya disponible. El harness no integra mocks en el artefacto productivo. Los resultados y capturas quedan en `frontend/modules/2.2-finance/node_modules/.cache/sales-ui`.

Prueba HTTP DEV: `py scripts/validate_sales_read_dev_http.py --existing-fixture-report <reporte-identificado-046> --output <reporte-local>`. Requiere el perfil DEV autorizado y actores sintéticos existentes; lee sus credenciales únicamente en memoria y vuelve a suspender las fixtures en `finally`. No crea ventas ni toca clientes reales. No ejecutar contra otro entorno ni sustituir el reporte por datos reales.

Pendiente fuera de esta entrega: asignación funcional de roles a usuarios reales sin sustituir inadvertidamente su rol propietario; facturación, cobros, venta manual y otras fuentes. La pantalla no habilita ninguna de estas operaciones.
