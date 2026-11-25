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
Mis compras presenta los estados financieros canónicos como solo lectura:
`PENDING_VERIFICATION`, `VALIDATED`, `REJECTED` y `PENDING_COLLECTION`, dejando
la revisión y modificación exclusivamente en Finanzas.

El checkout separa la selección del medio de pago de los datos bancarios. Pago
móvil y transferencia abren un paso adicional con los datos configurados por la
tienda, copia individual, copia completa en formato bancario, referencia y banco
emisor venezolano. Efectivo al recibir y punto de venta pasan directamente a la
revisión. La copia completa del monto exige una tasa de cambio real publicada en
la configuración; nunca usa una tasa simulada. El backend conserva la validación
de la referencia, del pagador y del estado financiero.

La entrega exige una dirección guardada por el cliente con latitud y longitud
válidas. El checkout no acepta texto libre sin geocodificación; la API y la
función transaccional vuelven a validar este contrato antes de crear el pedido.
El pedido conserva nombre y teléfono operativo en su snapshot de cliente.

Ubicación canónica: `frontend/modules/2.3-ecommerce/2.3.2-stores/storefront/`.
Hosting DEV: https://tienda-dev.uonify.com

La exportación web usa `npm run build` y genera `dist/`. Android/iOS comparten
los componentes React Native; el flujo Cognito universal y su almacenamiento
seguro nativo forman parte de la siguiente entrega antes de distribuir binarios.

## Modernización visual móvil

Home, Header, Cuenta pública y Explorar adoptan progresivamente la composición
documentada en `Mobile actual/Modernizar una aplicación`, manteniendo Expo,
Expo Router, Cognito y los contratos reales del Storefront. El prototipo se usa
solo como referencia visual: no se copian sus fixtures, rutas hash, catálogo,
ubicación, pagos ni comportamiento simulado. La primera etapa conserva el nodo,
la identidad de tienda, las categorías, los productos, el carrito y las acciones
de inicio de sesión y registro provenientes de la implementación canónica.

Validación local de esta etapa: viewport web de 390 × 844 px, `typecheck`,
`lint`, pruebas unitarias y exportación web local.

## Contrato pendiente del asistente de compra

El frontend queda preparado para conectar el asistente exclusivamente a través
de la API de MasterERP. La ruta se activa con
`EXPO_PUBLIC_STOREFRONT_ASSISTANT_PATH`; sin esa variable, el compositor conserva
la búsqueda normal del catálogo y no simula respuestas ni consulta proveedores
externos.

La propuesta de integración envía `domain`, `message`, `conversation_id` y
`node_id`, además de `X-Tenant-Id`. Espera una respuesta con
`conversation_id`, `message` y opcionalmente `product_ids`. El backend pendiente
debe resolver y volver a autorizar tenant, empresa, tienda y nodo, consultar las
APIs canónicas de Catálogo e Inventario y limitar cualquier herramienta de
Pedidos al usuario autenticado. Esta preparación frontend no acredita que el
endpoint, el agente ni su infraestructura estén implementados o desplegados.

Al seleccionar una variante, la ficha, la compra rápida y el carrito muestran
su imagen asociada o el icono neutro. El precio de una variante sigue el precio
base más su ajuste, como en el checkout canónico.
