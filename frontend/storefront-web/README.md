# Storefront Expo

Seguimiento de recuperación: [checklist de Fase 9](../../docs/PHASE9_STOREFRONT_CHECKLIST.md).
Evidencia DEV: [publicación y rollback](../../docs/PHASE9_STOREFRONT_DEV_DEPLOYMENT.md).

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
`EXPO_PUBLIC_STOREFRONT_DOMAIN`. Para servir varios tenants desde el mismo
artefacto web se usa `EXPO_PUBLIC_STOREFRONT_TENANT_MAP`, un JSON explícito de
dominio a UUID de tenant, por ejemplo
`{"tienda-a.example.com":"<tenant-a>","tienda-b.example.com":"<tenant-b>"}`.
Web siempre usa el hostname realmente abierto; el tenant por defecto solo se
acepta cuando coincide con `EXPO_PUBLIC_STOREFRONT_DOMAIN`. Un dominio no
registrado falla cerrado y no reutiliza el catálogo de otro tenant.

La API deriva y valida el contexto efectivo;
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

Perfil, direcciones y pedidos cuentan con un candidato canónico protegido por
el ID token Storefront. El servidor deriva cliente, empresa y tienda desde
`issuer + sub`, tenant y dominio; el navegador no envía `customer_id`. El alta
nueva crea una identidad de cliente por tienda sin asociar cuentas por email.

## Fase 9 — recuperación visual

Inicio, asistente de compra, navegación, catálogo, producto, carrito y checkout
se recuperan dentro de esta aplicación, sin reutilizar autenticación, endpoints
ni datos del frontend legacy. El asistente de Inicio dirige búsquedas al catálogo
canónico; no ejecuta operaciones autónomas ni sustituye la autorización de API.

Validación local del 2026-11-06: typecheck, lint, export web y estructura
aprobados. La prueba visual móvil de Inicio y Producto se realizó en Chrome con
un catálogo simulado que respeta el contrato público. No se publicó ni modificó
el hosting DEV; cualquier despliegue queda pendiente de aprobación visual.
