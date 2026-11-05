# Storefront web

Tienda pública base, multi-tenant y configurable, comparable al núcleo crudo de
un e-commerce: marca, categorías, catálogo disponible y carrito. Consume las
capacidades canónicas por API y no copia Productos ni Inventario.

Los módulos opcionales llegan en `store.modules`; el checkout emite el evento
`mastererp:checkout` y llama al adaptador autenticado `/v1/storefront/checkout`.
El servidor deriva tienda, nodo, cliente y precios canónicos; reserva Inventario
y crea el Pedido en una transacción idempotente, sin confiar en esos valores del
navegador. Esto no acopla la tienda base a Repartidores. Variables:
`VITE_STOREFRONT_API_URL`, `VITE_TENANT_ID` y `VITE_STOREFRONT_DOMAIN`. No usa
access tokens públicos ni secretos.

Decisión de identidad para el corte: los clientes migran al Cognito de
MasterERP y deben autenticarse nuevamente. Una invitación explícita conserva el
carrito durante PKCE y vincula exclusivamente por `issuer + sub`; nunca por
coincidencia de correo. Los access e ID tokens viven solo en memoria. Estado:
catálogo público validado en DEV; identidad candidata aprobada localmente y
checkout canónico implementado localmente y pendiente de promoción/prueba DEV.
