# App Shell

Compatibilidad de Catálogo: las rutas existentes `/modulos/catalogo/<entidad>`
aceptan también `/new` y `/<id>/view` para mostrar los editores completos
compartidos con Ecommerce. Se conservan los controles de acceso y contexto.

Ubicación técnica del shell general Uonify, junto a `frontend/modules`. Estado: primer recorrido implementado en código; validación DEV documentada en la guía enlazada abajo.

El [contrato vigente](../../docs/FRONTEND_ARCHITECTURE.md) define `app-dev.uonify.com` como entrada general DEV. Objetivo: dashboard con chat y menú de módulos habilitados para el tenant y autorizados para el usuario. Si solo dispone de Finanzas, verá ese módulo; otros se incorporan al mismo espacio conforme se habiliten y autoricen. Se puede navegar desde el menú sin conversar.

Las pantallas se presentan dentro del espacio de Uonify, conservando navegación, identidad y contexto comunes. El shell coordina layout, navegación y selección de tenant/empresa; las APIs autorizan cada operación y los módulos conservan sus reglas. Menús, URLs y contexto frontend no conceden permisos.

Finanzas mantiene componentes y entrega propios; `finanzas-dev.uonify.com` es un acceso independiente de desarrollo y pruebas, no la navegación objetivo del usuario final. El primer recorrido integra componentes durante el build y define rutas hash internas, documentadas abajo; no requiere una entrada independiente `/finanzas`. No se reorganizan carpetas ni se elimina hosting por documentar esta decisión.

## Primera implementación DEV

Shell React compartido en src/Shell.jsx, sesión/contexto en src/session.jsx. Composición en build con el módulo Finanzas: un código de pantallas y dos artefactos publicables. Rutas hash internas, recuperación PKCE de sesión y contexto revalidado; la API autoriza cada operación. Ver [mecanismo, publicación y pruebas](../../docs/FINANCE_UI_INTEGRATION.md). El estado de validación se informa allí; no se acredita por compilar.

<!-- ux-ui-standard:start -->
## UX/UI compartida

Antes de diseñar o implementar pantallas administrativas, consultar el [estándar UX/UI](../../docs/UX_UI_STANDARD.md) y el README funcional. Reutilizar la identidad Inter/gris/azul, componentes y tokens de la referencia de Finanzas, respetando la composición del shell y los contratos del módulo. Las instrucciones heredables se encuentran en frontend/AGENTS.md dentro de Platform.
<!-- ux-ui-standard:end -->
