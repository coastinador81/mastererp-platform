# MasterERP Platform

Entrada rápida: [START_HERE.md](START_HERE.md).

## Mapa físico y referencias

```text
frontend/{app-shell,modules,shared,agents-web,portal-web,storefront-web,super-admin-web}/
backend/{modules,shared,platform-base,platform-api,mcp-gateway,uonify-core,digital-sales-adapter}/
docs/
scripts/
.github/workflows/
```

[Arquitectura](docs/ARCHITECTURE.md). Las rutas con llaves resumen carpetas existentes, no son nombres literales. Database usa workflows existentes; publicar cambios observados puede aplicar SQL automáticamente. En Platform las pruebas Python de onboarding requieren sus dependencias y, para integración, una base desechable autorizada. Infrastructure no tiene un despliegue consolidado listo: revisar transición de stacks antes de aplicar plantillas.

Código frontend y backend de MasterERP, rama dev.

- `frontend/app-shell/`: consola principal Uonify (implementación pendiente).
- `frontend/modules/`: módulos visuales con numeración funcional.
- `frontend/shared/`: UI, tipos y contratos compartidos.
- `backend/modules/`: módulos funcionales, con sus servicios y Lambdas.
- `backend/shared/`: seguridad y código transversal del backend.
- Las aplicaciones web existentes se conservan bajo `frontend/`; los adaptadores técnicos existentes, bajo `backend/`.

Infraestructura AWS en mastererp-infrastructure; RDS y migraciones oficiales en mastererp-database. Los servicios internos de Python conservan su nombre y sus imports. El código histórico db-migrator se conserva bajo backend/platform-base hasta revisar su retirada; no se despliega como una segunda Lambda.

Configuración genérica futura: `DATABASE_URL`, `APP_ENV` y `PORT`.

## Guía de trabajo

Leer [PROJECT.md](PROJECT.md), [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), [carpetas](docs/FOLDER_STANDARD.md), [desarrollo](docs/DEVELOPMENT_STANDARD.md) y [registro](docs/MODULE_REGISTRY.md). Requisito para validación local: Python disponible; ejecutar `python scripts/validate_structure.py` (en Windows puede usarse `py scripts/validate_structure.py`) y `git diff --check`. No es obligatorio instalar herramientas locales para consultar documentación; el workflow existente Validate structure realiza el control en GitHub.

Estado: estructura funcional creada; las implementaciones y despliegues se distinguen en PROJECT.md y README de cada módulo. No hay un build frontend operativo declarado en este repositorio.
