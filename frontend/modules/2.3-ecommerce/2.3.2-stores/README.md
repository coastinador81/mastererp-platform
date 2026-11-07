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
