# Operations frontend

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

- Inter local con fallback sans-serif; fondo #F6F8FC, superficies y menú blancos, texto #4B5563, secundario #667085 y acentos azules.
- Cuando haya tabla: 14 px, peso 400 y #667085 en todas las celdas; encabezados #F4F7FB y separadores #E8EDF3. Códigos y nombres sin negrita ni subrayado permanente.
- Reutilizar tokens y componentes. Títulos grises de peso 500, iconos de línea, espaciado consistente y adaptación a móvil.
- En listados con ficha, preservar enlace accesible en el nombre, teclado/nueva pestaña y selección de texto; hover/foco visibles y controles internos independientes.
- Habilitar búsqueda y acciones solo con comportamiento real y contrato autorizado, conservando tenant, empresa y permisos; mostrar carga, vacío, error y conflicto cuando correspondan.

Esta sección orienta el diseño; no acredita implementación ni añade requisitos funcionales. Ver la guía para composición aplicable, pruebas y variantes justificadas.
<!-- ux-ui-standard:end -->
