# Operations frontend

## Catálogo administrativo modernizado

Ver [implementación, contratos y límites de Catálogo](2.3.4-catalog/README.md).
El selector presenta Operaciones o Catálogo y solo sus rutas autorizadas;
conserva Métodos de pago dentro de Operaciones. La cabecera reutiliza la misma
estructura compartida que Finanzas: Uony, chat de Uonify, lanzador y control de
sesión, aplicando los fundamentos corporativos compartidos. Arimo y estilos
acotados; no cambia hosting ni permisos.

> Organización vigente: Ecommerce integra Pedidos, Tiendas, Website, Catálogo, Contenido y Marketplaces. Nodos y Preparación pertenecen a Inventario; Rutas de reparto a Transporte. Se conserva el frontend administrativo existente y sus contratos. Los apartados históricos conservados describen el contrato/estado previo cuando difieran; no modifican el mapa nuevo.


Objetivo específico: Administrar E-commerce y su operación de pedidos,
preparación, rutas y nodos desde una aplicación autenticada independiente.

Responsabilidad: E-commerce administrativo, pedidos, preparación, rutas,
nodos, catálogo e inventario. El Storefront comprador y Digital Sales conservan
sus responsabilidades propias; este módulo consume sus contratos canónicos sin
copiar datos.

Estado: primera aplicación independiente compilable para
`ecom-dev.uonify.com`, basada en el patrón técnico de Finanzas. Comparte Cognito
MasterERP y resuelve tenant, empresa, módulos y permisos mediante las APIs de
identidad. El resumen organiza Gestión de e-Commerce y Gestión de Catálogo;
cada pantalla se muestra solo con su permiso. La API vuelve a autorizar cada
operación. Facturas permanece pendiente de contrato canónico.

## Contrato y estado de esta capa

Código: 2.3. Nombre/ruta: `2.3-ecommerce`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Ecommerce; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: `npm run build`, pruebas Cognito y pruebas de acceso del
módulo pasan localmente. No acredita hosting DEV, configuración Cognito del
nuevo callback, infraestructura, datos reales ni aislamiento E2E.

Validaciones: estructura local mediante `scripts/validate_structure.py`.
Pendientes: callback/logout Cognito para el nuevo origen, CloudFront/S3 y proxy
de APIs propios, pipeline OIDC mínimo, pruebas con dos tenants, prueba visual y
publicación DEV autorizada. No realizar DNS ni despliegue como efecto implícito.

<!-- ux-ui-standard:start -->
## UX/UI común

Aplicar el [estándar UX/UI de MasterERP](../../../docs/UX_UI_STANDARD.md) antes de crear o modificar esta interfaz; el README conserva el alcance y estado funcional descritos arriba.

- Arimo local con fallback sans-serif; fondo #F6F8FC, superficies y menú blancos, texto #4B5563, secundario #667085 y acentos azules.
- Cuando haya tabla: 14 px, peso 400 y #667085 en todas las celdas; encabezados #F4F7FB y separadores #E8EDF3. Códigos y nombres sin negrita ni subrayado permanente.
- Reutilizar tokens y componentes. Títulos grises de peso 500, iconos de línea, espaciado consistente y adaptación a móvil.
- En listados con ficha, preservar enlace accesible en el nombre, teclado/nueva pestaña y selección de texto; hover/foco visibles y controles internos independientes.
- Habilitar búsqueda y acciones solo con comportamiento real y contrato autorizado, conservando tenant, empresa y permisos; mostrar carga, vacío, error y conflicto cuando correspondan.

Esta sección orienta el diseño; no acredita implementación ni añade requisitos funcionales. Ver la guía para composición aplicable, pruebas y variantes justificadas.
<!-- ux-ui-standard:end -->

## Navegacion y panel contextual

Ecommerce conserva el shell base ya compartido con Finanzas. Incluye servicios relacionados (Chat, Finanzas, Ecommerce, Inventario, Agentes), lanzador y menu funcional compacto de 64 px que se expande por mouse, foco o boton. El contenido reserva el ancho del menu y del panel derecho; en movil ambos se presentan como paneles con cierre exterior/Escape. Se conservan rutas hash, permisos y contratos existentes; no se inventan enlaces a capacidades no autorizadas.

Uony reutiliza el componente existente `../2.2-finance/src/FinanceAssistant.jsx`, parametrizado con el nombre y la pantalla de Ecommerce. El borrador solo vive en memoria y se limpia al cambiar sesion, tenant o empresa. No lee registros ni manda mensajes; envio deshabilitado y conexion de IA pendiente. No implica OAuth, Gemini ni otras integraciones. El workflow observa explicitamente los archivos compartidos de los que depende; conserva OIDC, hosting y permisos actuales. La identidad visual propia de Finanzas no se activa por esta reutilizacion.

Validacion local: `npm run build` y `node --test src/access.test.mjs ../../shared/auth/cognito.test.mjs`. La ruta previa del workflow a las pruebas Cognito subia un nivel de mas; se corrige para ejecutar realmente ese archivo existente. Esta correccion no cambia autenticacion ni permisos.

## Continuidad de sesión entre aplicaciones DEV

Ecommerce conserva tokens y refresh token aislados en su propio origen. Cuando
entra sin sesión local, intenta una autorización PKCE silenciosa con
`prompt=none`: Cognito recupera la sesión existente de Uonify o Finanzas sin
pedir credenciales otra vez. Si Cognito no tiene una sesión válida, devuelve
`login_required` y Ecommerce muestra el acceso normal. No se pasan tokens por
URL, no se usan cookies amplias entre subdominios y las APIs siguen validando
identidad, tenant, empresa, módulo y permisos en cada operación.
