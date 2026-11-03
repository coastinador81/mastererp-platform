# App Shell

Ubicación técnica del shell general Uonify, junto a `frontend/modules`. Estado: integración del dashboard y pantallas de módulos pendiente; esta carpeta no acredita que ya esté implementada.

El [contrato vigente](../../docs/FRONTEND_ARCHITECTURE.md) define `app-dev.uonify.com` como entrada general DEV. Objetivo: dashboard con chat y menú de módulos habilitados para el tenant y autorizados para el usuario. Si solo dispone de Finanzas, verá ese módulo; otros se incorporan al mismo espacio conforme se habiliten y autoricen. Se puede navegar desde el menú sin conversar.

Las pantallas se presentan dentro del espacio de Uonify, conservando navegación, identidad y contexto comunes. El shell coordina layout, navegación y selección de tenant/empresa; las APIs autorizan cada operación y los módulos conservan sus reglas. Menús, URLs y contexto frontend no conceden permisos.

Finanzas mantiene componentes y entrega propios; `finanzas-dev.uonify.com` es un acceso independiente de desarrollo y pruebas, no la navegación objetivo del usuario final. El mecanismo técnico de integración y las rutas internas/enlaces directos siguen pendientes; no se impone `/finanzas`, iframe, Module Federation u otra solución. No se reorganizan carpetas ni se elimina hosting por documentar esta decisión.
