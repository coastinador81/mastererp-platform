# Frontends de MasterERP

El [contrato frontend oficial](../docs/FRONTEND_ARCHITECTURE.md) establece el espacio general de Uonify en app-dev.uonify.com: dashboard, chat y menú de módulos habilitados y autorizados. Sus pantallas deben presentarse dentro de ese espacio, sin obligar a conversar. Cada módulo principal conserva componentes, build, pipeline, despliegue y rollback propios; el mecanismo técnico de integración está pendiente, sin imponer iframe, Module Federation u otra solución. El hosting independiente de Finanzas DEV ya existe para desarrollo y pruebas; no demuestra integración en Uonify.

Se conservan las carpetas existentes de portal, super administración, agentes y storefront; su presencia no decide nuevos dominios o frontends financieros. La jerarquía funcional vive en frontend/modules/ y el shell en frontend/app-shell/. Los módulos sin implementación mantienen README; no crear código vacío ni reorganizar repositorios por esta documentación.
