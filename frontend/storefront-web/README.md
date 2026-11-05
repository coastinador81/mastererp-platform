# Storefront web

Tienda pública base, multi-tenant y configurable, comparable al núcleo crudo de
un e-commerce: marca, categorías, catálogo disponible y carrito. Consume las
capacidades canónicas por API y no copia Productos ni Inventario.

Los módulos opcionales llegan en `store.modules`; el checkout emite el evento
`mastererp:checkout` para que el adaptador autorizado de Pedidos/identidad lo
resuelva sin acoplar la tienda base a Repartidores u otros módulos. Variables:
`VITE_STOREFRONT_API_URL`, `VITE_TENANT_ID` y `VITE_STOREFRONT_DOMAIN`. No usa
access tokens públicos ni secretos.

Decisión de identidad para el corte: los clientes migran al Cognito de
MasterERP y deben autenticarse nuevamente. Una invitación explícita conserva el
carrito durante PKCE y vincula exclusivamente por `issuer + sub`; nunca por
coincidencia de correo. Los access e ID tokens viven solo en memoria. Estado:
catálogo público validado en DEV; identidad candidata aprobada localmente y
checkout canónico todavía pendiente.
