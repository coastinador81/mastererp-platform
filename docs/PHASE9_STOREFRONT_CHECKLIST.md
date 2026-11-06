# Fase 9 — checklist Storefront

Estado al 2026-11-06. Este checklist recupera la experiencia funcional de
`tumandaito-frontends/frontends/customer-app` dentro de
`frontend/storefront-web`, usando identidad, APIs y datos canónicos de
MasterERP. No autoriza copiar APIs legacy, secretos ni tokens al cliente.

## Puertas transversales

- [x] Mantener archivos fuente menores de 500 líneas.
- [x] Conservar Cognito Authorization Code + PKCE, sin secreto en el cliente.
- [x] Vincular identidad interna únicamente por `issuer + sub`, nunca por email.
- [x] Consumir Catálogo, Inventario y Pedidos canónicos, sin copias paralelas.
- [ ] Ejecutar pruebas E2E multi-tenant, autenticación, checkout y aislamiento.
- [ ] Aprobar revisión visual móvil, tablet y escritorio de todas las rutas.
- [x] Preparar workflow DEV manual con OIDC mínimo; falta desplegar el rol y
  aprobar prueba visual antes de ejecutarlo.

## 1. Configuración multitenant DEV

- [x] Resolver en Web el hostname realmente abierto.
- [x] Resolver tenant mediante mapa explícito dominio → UUID.
- [x] Fallar cerrado si el dominio no está registrado.
- [x] Separar carrito, invitación y checkout por tenant + dominio.
- [x] Confirmar que API/RLS valida tenant, dominio, tienda, empresa y nodo.
- [x] Inspeccionar Tumandaito DEV sin escritura:
  - tenant: `9095f990-c1f7-4ccb-953d-f84083331bd6`;
  - empresa: `8a13adba-1594-46e3-a41b-488fd91ea896`;
  - dominio: `tienda-dev.tumandaito.com`;
  - nodo: `4b6faf7f-805a-5923-a8cd-dfce92acda95`.
- [x] Versionar la configuración pública en `.env.dev` y usarla mediante
  `npm run build:dev`.
- [ ] Añadir segundo tenant fixture y probar que no cruza marca, configuración,
  categorías, productos, precios, inventario, carrito, perfil ni pedidos.
- [ ] Probar dominio desconocido, tenant ajeno, tienda inactiva y nodo inactivo.
- [ ] Aplicar `store.branding` y `store.configuration` a toda la experiencia.

## 2. Cognito, email y Google

- [x] Cliente DEV `mastererp-dev-storefront-web` con callback y logout propios.
- [x] Tokens de 15 minutos, refresh de un día y sesión administrada por Cognito.
- [x] Invitación de un solo uso y reclamación idempotente por `issuer + sub`.
- [x] Declarar Google como Identity Provider del User Pool MasterERP; pendiente
  aplicar el change set con credenciales OAuth administradas.
- [x] Declarar Google en `SupportedIdentityProviders` del cliente Storefront.
- [x] Mapear claims mínimos verificados: `sub`, `email`, `email_verified`,
  `given_name`, `family_name`, `name` y `picture`, según contrato aprobado.
- [x] Exponer “Continuar con Google” mediante Hosted UI Cognito; el cliente no
  recibe ni persiste access/refresh tokens de Google.
- [x] Recuperar login, registro/confirmación administrados por Hosted UI,
  logout y expiración local. Pendientes reenvío, cancelación y matriz completa
  de errores del `customer-app`.
  cancelación y errores del `customer-app`.
- [ ] Probar primer acceso, usuario existente, email no verificado, proveedor
  duplicado, invitación vencida y cambio de usuario.

## 3. Perfil de cliente por tenant

- [x] Definir contrato canónico `GET/PATCH /v1/storefront/me` y alta idempotente
  por `issuer + sub` + dominio, sin unir clientes por email.
- [ ] Persistir por tenant/empresa/cliente: nombre, nombres, apellidos, teléfono,
  fecha de nacimiento y foto; email e identidad externa siguen gobernados por
  Cognito y `issuer + sub`.
- [ ] Migrar validación de teléfono venezolano `+58` y fecha de nacimiento.
- [ ] Recuperar pantalla de perfil, edición, seguridad, notificaciones, ayuda y
  políticas con configuración propia del tenant.
- [x] Corregir “Mi cuenta” para abrir Perfil; logout es una acción aparte.
- [ ] Evitar que caché o respuestas tardías sobrevivan al cambio de tenant o
  usuario.

## 4. Direcciones por tenant

- [x] Definir contrato de listar/crear/editar dirección del cliente; el primer
  corte persiste etiqueta, dirección, referencia y predeterminada.
- [ ] Conservar campos: `label`, `address`, `zone`, `unit`, `reference`,
  `latitude`, `longitude` e `isDefault`.
- [ ] Recuperar autocompletado y selector de punto en mapa sin exponer llaves.
- [ ] Validar dirección, zona, coordenadas y pertenencia al cliente en API.
- [x] Permitir varias direcciones y una predeterminada por tenant/empresa.

## 5. Checkout completo por configuración del tenant

- [x] Checkout canónico actual crea reserva y pedido atómicamente.
- [x] El servidor recalcula tienda, nodo, precios, inventario y totales.
- [ ] Recuperar pasos: entrega → pago → detalles de pago → revisión.
- [ ] Entrega: inmediata/programada, slot, sucursal/nodo y dirección guardada.
- [ ] Pago: efectivo, pago móvil y transferencia, monedas USD/VES y referencia.
- [ ] Datos de cobro por tenant: banco, documento, teléfono y cuenta.
- [ ] Consumir en UI la configuración canónica ya disponible por tenant: costo
  de entrega, mínimo, moneda, horarios, slots y métodos habilitados. Tasa,
  sucursales y datos bancarios aún requieren contrato canónico.
- [ ] Ampliar API/SQL: hoy solo acepta `realtime`, `cash` y dirección de texto.
- [ ] Guardar snapshots de cliente, dirección, entrega y pago en el pedido sin
  confiar en importes o configuración enviados por el navegador.
- [ ] Probar idempotencia, inventario insuficiente, nodo cerrado, pago inválido,
  dirección incompleta y cambio de tenant durante checkout.

## 6. Catálogo, ofertas y carrito

- [x] Inicio, catálogo, producto y carrito consumen catálogo canónico por tenant.
- [x] Carrito aislado por tenant + dominio.
- [ ] Aplicar imágenes, unidades, atributos y disponibilidad reales.
- [ ] Definir contrato canónico de ofertas; retirar el filtro provisional que
  considera oferta a todo producto con precio positivo.
- [ ] Recuperar favoritos por cliente/tenant.
- [ ] Recuperar búsqueda, categorías, vacíos, skeletons y errores del original.

## 7. Pedidos y seguimiento

- [x] Implementar lista y detalle de pedidos del cliente autenticado.
- [x] Mostrar estados, líneas, totales, entrega y pago. Eventos autorizados
  siguen pendientes de contrato Storefront.
- [ ] Recuperar seguimiento y repetición de compra cuando producto lo apruebe.
- [ ] Probar aislamiento por tenant, cliente y empresa.

## 8. Asistente de compra

- [x] Experiencia visual y búsqueda dirigida al catálogo.
- [ ] Conectar conversación al agente/Gateway MCP autorizado.
- [ ] Limitar sugerencias y acciones al catálogo y configuración del tenant.
- [ ] Exigir confirmación antes de modificar carrito o crear pedido.
- [ ] No almacenar prompts sensibles ni permitir acceso directo a base de datos.

## 9. Calidad, hosting y cierre

- [x] Typecheck, lint, build web y estructura local aprobados en el primer corte.
- [x] Prueba visual local de Inicio y Producto.
- [ ] Añadir tests unitarios de resolución dominio → tenant y estado aislado.
- [ ] Añadir E2E de Inicio, catálogo, producto, carrito, Cognito y checkout.
- [x] Inventariar hosting restaurado: cuenta propietaria `941751053509`, bucket
  versionado `tmi-dev-client`, distribución `E2PLU72V9YKM01` y dominio
  `tienda-dev.tumandaito.com`.
- [x] Declarar rol OIDC de publicación limitado al bucket y distribución y
  workflow manual `publish-storefront-dev.yml`; falta desplegar el rol.
- [x] Publicar el primer corte DEV con backup recuperable del índice anterior.
- [x] Ejecutar smoke real de índice, bundle y catálogo; registrar evidencia.
- [ ] Completar revisión visual manual del build publicado en móvil y escritorio.
- [x] Retirar la publicación legacy de `customer-app` en
  `tumandaito-frontends` y desactivar el job manual equivalente en
  `tumandaito-infrastructure`, sin afectar Admin ni Landing.
