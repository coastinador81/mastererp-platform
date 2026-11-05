# Storefront Expo

App universal Expo/React Native Web, pública, multi-tenant y configurable. La
primera recuperación visual conserva la experiencia de TuMandadito para inicio,
catálogo, producto, carrito y checkout, usando la paleta de MasterERP. Consume
las capacidades canónicas por API y no copia Productos ni Inventario.

Los módulos opcionales llegan en `store.modules`; el checkout emite el evento
`mastererp:checkout` y llama al adaptador autenticado `/v1/storefront/checkout`.
El servidor deriva tienda, nodo, cliente y precios canónicos; reserva Inventario
y crea el Pedido en una transacción idempotente, sin confiar en esos valores del
navegador. Esto no acopla la tienda base a Repartidores. Variables:
`EXPO_PUBLIC_STOREFRONT_API_URL`, `EXPO_PUBLIC_TENANT_ID` y
`EXPO_PUBLIC_STOREFRONT_DOMAIN`. La API deriva y valida el contexto efectivo;
estas variables no conceden acceso. El carrito se separa por tenant y dominio.
No usa access tokens públicos ni secretos.

Decisión de identidad para el corte: los clientes migran al Cognito de
MasterERP y deben autenticarse nuevamente. Una invitación explícita conserva el
carrito durante PKCE y vincula exclusivamente por `issuer + sub`; nunca por
coincidencia de correo. Los access e ID tokens viven solo en memoria. Estado:
catálogo público validado en DEV; identidad candidata aprobada localmente y
checkout canónico desplegado y probado en DEV. Cognito, invitación de un solo
uso y checkout real aprobaron; MasterERP crea atómicamente reserva y pedido.

La exportación web usa `npm run build` y genera `dist/`. Android/iOS comparten
los componentes React Native; el flujo Cognito universal y su almacenamiento
seguro nativo forman parte de la siguiente entrega antes de distribuir binarios.
