# eCommerce

Objetivo específico: Gestionar venta online; catálogo y finanzas conservan sus datos propietarios.

Responsabilidad: eCommerce, dentro de Ecommerce.
Estado: interfaz administrativa integrada al código fuente del app-shell;
promoción del nuevo panel a DEV pendiente.

Permite editar tiendas, activarlas, definir marca y declarar módulos opcionales.
El panel conecta Pedidos, Productos, Inventario y Preparación según permisos.
Usa el token runtime de Uonify; no almacena tokens en variables de build.


## Contrato y estado de esta capa

Código: 2.3.2. Nombre/ruta: `2.3.2-stores`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Ecommerce; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: build Vite local y composición Uonify aprobados. Smoke del
nuevo panel en DEV pendiente.

Validaciones: estructura local mediante scripts/validate_structure.py. Pendientes: contratos específicos, responsable nominal y pruebas funcionales antes de habilitar esta capacidad.

## Storefront público (comprador)

- **Código:** `storefront/` (Expo Web; migrado desde `frontend/storefront-web`).
- **DEV:** https://tienda-dev.uonify.com
- **Build:** `cd storefront && npm ci && npm run build` (ver `.env.dev`).
- **CI:** `.github/workflows/publish-storefront-dev.yml`

## Métodos de pago del Admin

- Consulta las tiendas reales de la empresa mediante `GET /v1/companies/{company}/stores` y guarda únicamente la tienda seleccionada mediante `PATCH /v1/companies/{company}/stores/{store}`.
- La edición exige el permiso `digital_sales.ecommerce.write`; ocultar o deshabilitar controles en la interfaz no sustituye la autorización del backend.
- Cada `PATCH` envía la `version` recibida para control de concurrencia. La respuesta guardada reemplaza la versión local antes de permitir otra edición.
- Al guardar se conserva la configuración completa de la tienda y se actualizan solo `configuration.payments` y `configuration.paymentDetails`; también se preservan claves de pago no administradas por el formulario.
- La pantalla diferencia carga, error, ausencia de tiendas y selección activa. Cambiar de tienda actualiza el panel sin recargar la página y solicita confirmación si hay cambios sin guardar.
- Admite efectivo al recibir, punto de venta al entregar o retirar, pago móvil, transferencia y métodos propios. Las referencias del comprador quedan pendientes de verificación; la interfaz no acredita el pago.

<!-- ux-ui-standard:start -->
## UX/UI común

Aplicar el [estándar UX/UI de MasterERP](../../../../docs/UX_UI_STANDARD.md) antes de crear o modificar esta interfaz; el README conserva el alcance y estado funcional descritos arriba.

- Arimo local, centralizada en `../../src/typography.css`, con fallback sans-serif; fondo #F6F8FC, superficies y menú blancos, texto #4B5563, secundario #667085 y acentos azules.
- Cuando haya tabla: 14 px, peso 400 y #667085 en todas las celdas; encabezados #F4F7FB y separadores #E8EDF3. Códigos y nombres sin negrita ni subrayado permanente.
- Reutilizar tokens y componentes. Títulos grises de peso 500, iconos de línea, espaciado consistente y adaptación a móvil.
- En listados con ficha, preservar enlace accesible en el nombre, teclado/nueva pestaña y selección de texto; hover/foco visibles y controles internos independientes.
- Habilitar búsqueda y acciones solo con comportamiento real y contrato autorizado, conservando tenant, empresa y permisos; mostrar carga, vacío, error y conflicto cuando correspondan.

Esta sección orienta el diseño; no acredita implementación ni añade requisitos funcionales. Ver la guía para composición aplicable, pruebas y variantes justificadas.
<!-- ux-ui-standard:end -->
