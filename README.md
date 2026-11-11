# MasterERP Platform

## Arquitectura frontend

MasterERP conserva datos, reglas, procesos y autorización. `dev.uonify.com` es el producto principal y la entrada general DEV: chat, cuenta, espacios y lanzador conectan las aplicaciones autorizadas. Los subdominios de Finanzas, Ecommerce, Transporte y los demás módulos son superficies independientes del mismo producto, no proyectos separados; conservan build, despliegue y rollback propios. Conversar no es obligatorio y las vistas manuales usan los mismos contratos. `app-dev.uonify.com` es el shell administrativo histórico. Cognito autentica; MasterERP autoriza cada operación por API. Ver [contrato oficial y estado desplegado](docs/FRONTEND_ARCHITECTURE.md).

Entrada rápida: [START_HERE.md](START_HERE.md).

Patrón obligatorio para capacidades nuevas: [patrón verificable](docs/IMPLEMENTATION_PATTERN.md).

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

<!-- ux-ui-standard:start -->
## Estándar UX/UI de los módulos

La identidad común parte del manual corporativo y de la experiencia principal de Uonify. Finanzas/Proveedores concreta el patrón administrativo con Inter regular, menú blanco, fondo gris azulado, acentos azules, tablas suaves e iconos de línea. Leer el [estándar UX/UI y la imagen de referencia](docs/UX_UI_STANDARD.md) antes de desarrollar una interfaz o su contrato. La implementación visual pertenece a Platform; esta guía no acredita que todos los módulos estén adaptados ni cambia las responsabilidades de cada repositorio.
<!-- ux-ui-standard:end -->

## Diseño de Uonify: el manual de identidad corporativa es canon

Todo lo visual de Uonify —módulo `0-uonify` y https://dev.uonify.com: interfaz, UX/UI, marca, logotipos, color, tipografía, iconografía, componentes, web y piezas gráficas— se rige por el [manual de identidad corporativa de Uonify](frontend/modules/0-uonify/identidad-corporativa/Uonify_Identidad_Corporativa.pdf). Es el canon por decisión del Product Owner (08-11-2026), una excepción del propietario documentada con su alcance:

- Quien vaya a tocar cualquier diseño o UX/UI de Uonify lee antes el manual.
- No se inventan diseños, estilos ni patrones de UX/UI nuevos. Todo cambio visual respeta el manual, y lo que el manual no cubra no se improvisa: lo decide el Product Owner.
- Un cambio visual de Uonify que no cumpla el manual no se fusiona.
- En Uonify prevalece este manual; [docs/UX_UI_STANDARD.md](docs/UX_UI_STANDARD.md) sigue rigiendo las interfaces administrativas de MasterERP.
- Excepción del propietario (08-11-2026): Finanzas (`2.2-finance`) adoptó también este manual mediante una capa de tema propia de `2.2-finance` (selector `:root.finance-app.uonify-brand`). Decisión ampliada el 11-11-2026: Ecommerce, Transporte, Nodos, storefront y las demás superficies convergen gradualmente en los fundamentos corporativos compartidos, conservando la composición y tipografía aprobadas para cada canal. No cambian la funcionalidad, las APIs, las rutas, los permisos ni los datos.

## Organización de aplicaciones vigente

La numeración local se ha actualizado a la [distribución de aplicaciones y mapa de transición](docs/MODULE_RENUMBERING.md). No implica despliegue, migración de stacks ni cambio de contratos SQL/API.
