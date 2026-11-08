# Frontends de MasterERP

El [contrato frontend oficial](../docs/FRONTEND_ARCHITECTURE.md) establece el espacio general de Uonify en app-dev.uonify.com: dashboard, chat y menú de módulos habilitados y autorizados. Sus pantallas deben presentarse dentro de ese espacio, sin obligar a conversar. Cada módulo principal conserva componentes, build, pipeline, despliegue y rollback propios; el primer recorrido usa composición de código en build y rutas hash, sin iframe ni Module Federation. La ampliación a otros módulos requiere su diseño. El hosting independiente de Finanzas DEV ya existe para desarrollo y pruebas; su primer recorrido de Clientes/Proveedores también se integra en Uonify; ver [implementación y pruebas](../docs/FINANCE_UI_INTEGRATION.md).

Se conservan las carpetas existentes de portal, super administración, agentes y storefront; su presencia no decide nuevos dominios o frontends financieros. La jerarquía funcional vive en frontend/modules/ y el shell en frontend/app-shell/. Los módulos sin implementación mantienen README; no crear código vacío ni reorganizar repositorios por esta documentación.

<!-- ux-ui-standard:start -->
## UX/UI compartida

Antes de diseñar o implementar pantallas administrativas, consultar el [estándar UX/UI](../docs/UX_UI_STANDARD.md) y el README funcional. Reutilizar la identidad Inter/gris/azul, componentes y tokens de la referencia de Finanzas, respetando la composición del shell y los contratos del módulo. Las instrucciones heredables se encuentran en frontend/AGENTS.md dentro de Platform.
<!-- ux-ui-standard:end -->
