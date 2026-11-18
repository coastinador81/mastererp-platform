# Base frontend de Inventario DEV

Propietario: 2.1 Inventario, aplicación independiente. Entrada objetivo: https://inventario-dev.uonify.com. El resto de pantallas conserva su base visual y datos mock. Recepciones pendientes reutiliza la sesión Cognito compartida y consulta en solo lectura las órdenes de compra autorizadas de Finanzas; no sustituye el componente funcional existente 2.1.1-inventory/src/Inventory.jsx ni su contrato.

## Menú y navegación

- Resumen.
- Existencias: por producto y por sucursal.
- Movimientos: entradas, salidas y transferencias.
- Recepciones: pendientes y recibidas.
- Conteos y ajustes: conteos físicos y ajustes.
- Configuración.

La aplicación conserva encabezado y menú al navegar con `?vista=...`; enlaces directos, recarga e historial nativos. Chat principal y lanzador abren en la misma pestaña. Menú responsive, Inter local, blanco/gris azulado y acentos azules del estándar UX/UI. Fuente e iconos se referencian desde las implementaciones existentes de Finanzas, sin duplicar archivos ni montar su aplicación.

## Sucursal y Nodos

Decisión del propietario de esta entrega: Nodos es una capacidad opcional de Ecommerce. Cada nodo representa por ahora una sucursal. Sin activación, el contrato objetivo es una sucursal predeterminada y ningún selector de nodos. La base no crea esa sucursal en backend ni presupone el tenant/empresa del usuario. Existencias por sucursal y transferencias muestran el requisito Nodos, sin habilitar operaciones ni simular activación.

Al integrar servicios, Nodos activado permitirá Ecommerce e Inventario multinodo según permisos y contexto autorizado. Preparación pertenece a Ecommerce. Almacenes y ubicaciones internas quedan fuera de alcance. No se trasladan carpetas históricas 2.1.2-nodes/2.1.3-preparation en esta tarea ni se cambian contratos API/SQL por una decisión de menú; la transición organizativa queda pendiente y explícita.

Maestro de productos reutilizado de Catálogo. Recepciones Pendientes consulta órdenes de Finanzas en modo lectura, con sesión Cognito y permisos de Compras existentes. El usuario selecciona espacio y empresa autorizados. La API no registra recepciones ni afecta existencias; Recibidas permanece vacía hasta que exista el flujo de registro. Las órdenes sin líneas vinculables o sin validación completa se muestran como “Requiere validación”.

## Build y publicación

Desde esta carpeta: `npm ci`, `npm run dev -- --port 5182 --strictPort`, `npm run build`. En este equipo se reutilizaron dependencias ya instaladas mediante un enlace local ignorado a node_modules de Finanzas; no es requisito de CI ni parte del commit.

Pipeline preparado: `.github/workflows/publish-inventory-dev.yml`, rama dev, OIDC con rol exclusivo. Variables no secretas INVENTORY_DEV_BUCKET e INVENTORY_DEV_DISTRIBUTION_ID provienen de outputs del stack mastererp-dev-inventory-frontend. Artefacto dist; assets inmutables y entrada no-cache, invalidación CloudFront. No incluye APIs ni callback Cognito. El rol no tiene acceso a otros buckets/distribuciones. Publicar el workflow requiere commit/push explícitos; el bootstrap inicial puede publicar el mismo artefacto con AWS CLI, documentado en Infrastructure.

Ver `docs/UX_UI_STANDARD.md` y `docs/FRONTEND_ARCHITECTURE.md` desde la raíz. La mayoría de pantallas conserva datos mock; Recepciones pendientes usa Cognito y autorización de lectura para consultar Finanzas. La vista no ejecuta operaciones de inventario.

## Verificación de esta entrega

Publicado por bootstrap AWS CLI en https://inventario-dev.uonify.com, 2026-11-08. Build aprobado; navegación, recarga, historial y móvil probados localmente y en el dominio DEV. Sin llamadas API, sin selector de nodos. YAML/Bash del workflow validados, pero el workflow todavía no está publicado ni ejecutado. Validadores estructurales y git diff --check aprobados. Este resultado corresponde al bootstrap inicial, anterior a la publicación del código en dev. El commit de publicación incorpora también el pipeline OIDC y los accesos compartidos de Inventario y Chat principal.

## Barra lateral de servicios relacionados

Inventario incorpora una barra estrecha a la izquierda del menú funcional: Chat, Ecommerce, Finanzas e Inventario activo. Reutiliza catálogo e iconos del lanzador mediante RelatedServicesRail; no añade servicios ni otro catálogo. En escritorio quedan dos niveles de navegación; en móvil los servicios aparecen en una franja horizontal bajo el encabezado, y el menú funcional continúa en panel lateral. Enlaces nativos, misma pestaña, etiquetas accesibles y títulos; Inventario activo se identifica sin enlace de recarga. No concede permisos ni implementa SSO. Publicación mediante el pipeline DEV propietario de Inventario; no modifica backend, datos ni permisos.