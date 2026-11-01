# MasterERP Platform

Código frontend y backend de MasterERP, rama dev.

- `frontend/app-shell/`: consola principal Uonify (implementación pendiente).
- `frontend/modules/`: módulos visuales con numeración funcional.
- `frontend/shared/`: UI, tipos y contratos compartidos.
- `backend/modules/`: módulos funcionales, con sus servicios y Lambdas.
- `backend/shared/`: seguridad y código transversal del backend.
- Las aplicaciones web existentes se conservan bajo `frontend/`; los adaptadores técnicos existentes, bajo `backend/`.

Infraestructura AWS en mastererp-infrastructure; RDS y migraciones oficiales en mastererp-database. Los servicios internos de Python conservan su nombre y sus imports. El código histórico db-migrator se conserva bajo backend/platform-base hasta revisar su retirada; no se despliega como una segunda Lambda.

Configuración genérica futura: `DATABASE_URL`, `APP_ENV` y `PORT`.
