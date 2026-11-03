# Frontends de MasterERP

El [contrato frontend oficial](../docs/FRONTEND_ARCHITECTURE.md) define Uonify como front general y frontends independientes por módulo principal, integrados por navegación federada, menú y chat. No comenzar con microfrontends embebidos. Cada frontend principal tendrá build, pipeline, despliegue y rollback propios; no se crean aquí.

Se conservan las carpetas existentes de portal, super administración, agentes y storefront; su presencia no decide nuevos dominios o frontends financieros. La jerarquía funcional vive en frontend/modules/ y el shell en frontend/app-shell/. Los módulos sin implementación mantienen README; no crear código vacío ni reorganizar repositorios por esta documentación.
