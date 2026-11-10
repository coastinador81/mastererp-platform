# Inventario de recuperación desde TuMandaito

Referencia de experiencia: `tumandaito-frontends/frontends/customer-app`. La
migración conserva la UX de la app y sustituye únicamente contratos, identidad,
persistencia y aislamiento por sus equivalentes MasterERP.

## Superficie funcional

| Experiencia TuMandaito | Estado MasterERP | Contrato real |
| --- | --- | --- |
| Home, header y menú superior | Recuperación en curso | Catálogo público por tenant + dominio |
| Tabs Inicio/Categorías/Ofertas/Pedidos/Perfil | Recuperado | Expo Router; cada destino conserva autorización propia |
| Búsqueda y filtros | Recuperado | Categoría, marca, precio, disponibilidad y orden sobre el catálogo de la tienda |
| Ofertas | Visual recuperada; contrato pendiente | El catálogo aún no devuelve `offer_price`; sin fallback ficticio |
| Categorías y productos | Recuperado; favoritos pendientes de contrato | `/v1/storefront/catalog` |
| Carrito | Recuperado | Sesión separada por tenant + dominio |
| Login, registro y Google | Disponible | Cognito MasterERP Authorization Code + PKCE |
| Mi cuenta y perfil | Paridad visual principal recuperada | `/v1/storefront/me` |
| Direcciones | Formularios y tarjetas recuperados; mapa pendiente | `/v1/storefront/me/addresses` |
| Mis compras y detalle | Recuperado con estados y progreso de seis pasos | `/v1/storefront/orders` |
| Checkout, entrega y pagos | Recuperado en tres pasos: Entrega, Pago y Revisar | `/v1/storefront/checkout` |
| Favoritos | Pendiente de contrato MasterERP | No reintroducir persistencia legacy |
| Notificaciones, ayuda, seguridad y políticas | Pendiente de contrato/contenido | No simular operaciones |

## Reglas de recuperación

- No copiar clientes API, tokens, endpoints ni selección de nodo de TuMandaito.
- No usar fixtures como respaldo del catálogo ni convertir cualquier precio en oferta.
- Mantener carrito, identidad y datos vinculados al par tenant + dominio.
- Reutilizar composición, navegación, jerarquía, assets y estados visuales de la
  última app; dividir archivos mayores de 500 líneas durante la adaptación.
- Cada pantalla protegida conserva Cognito MasterERP y autorización backend.

## Orden de trabajo

1. Shell responsive, header, menú, tabs y Home.
2. Catálogo, filtros, ofertas, producto y carrito.
3. Mi cuenta, perfil, direcciones, pedidos y detalle.
4. Checkout visual por pasos, pagos y confirmación.
5. Responsive, accesibilidad, estados vacíos/error y comparación visual.
