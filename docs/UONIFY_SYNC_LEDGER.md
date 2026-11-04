# Ledger de sincronización Uonify → MasterERP

> Documento común a los 3 repos (byte-idéntico: `platform`, `infrastructure`, `database`). Fuente de verdad del mapeo de la base de código Uonify (monolito local) a la estructura numerada de MasterERP. Propuesta del equipo Uonify para revisión del arquitecto; la numeración definitiva la valida el arquitecto en el PR.

## 0. Reglas de sincronización (duras)

1. **Nunca `push` ni `merge` directo a `dev`.** Toda entrega va por **rama + PR**. El PR no despliega (los workflows son `on: push: [dev]`); el **merge a `dev` es el acto gobernado** y dispara despliegues/SQL según rutas.
2. **Disparadores reales** (verificado en `.github/workflows`):
   - `database`: `apply-dev-database.yml` → push a `dev` en `schema/**`, `seeds/**`, `tests/**`, `migrations/lambda/**` → **aplica SQL a la RDS DEV real**. `deploy-dev-rds.yml` → `infrastructure/rds-dev-us-west-1.yaml`.
   - `platform`: `publish-finance-dev.yml` → `frontend/modules/2.2-finance/**`, `frontend/app-shell/src/**`, `frontend/shared/auth/*.mjs`, varios de `0-uonify`. `publish-uonify-dev.yml` → `frontend/modules/0-uonify/**`.
   - Los tres: `structure.yml` → también `on: pull_request` (valida estructura, `continue-on-error`, sin AWS; **inofensivo**).
3. **El `apply` de SQL a DEV lo autoriza el dueño**, caso por caso. Hasta ese "sí", las entregas de datos viajan en el PR pero **no se mergean**.
4. **Numeración de datos:** NO reusar las migraciones Uonify `001–137`. El empaquetador del migrador aplana rutas y aborta por colisión de nombres. Se continúa **la cadena del arquitecto**: siguiente `schema/NNN` libre = **037**.
5. **Numeración de módulos:** se mantiene la lógica del arquitecto. Lo que no tenga hueco se numera **siguiendo esa misma lógica** (ver §3) y se marca para confirmación en el PR; nunca se renumera lo existente.
6. **Cadencia:** un vertical a la vez (los runs de CI chocan; encolan, no cancelan). Cada entrega toca las 4 capas + READMEs + evidencia (`validation.json` con los 4 SHA correlacionados).
7. **PRODUCCIÓN de Google siempre CERRADA** (flag `False`) en todo lo que se suba del Estudio hasta orden expresa del dueño.

## 1. Mapeo maestro (componente Uonify → módulo MasterERP)

| Componente Uonify (local) | Módulo destino | Estrategia | Confianza |
|---|---|---|---|
| Cerebro Uony: chat, interpretación semántica, motor de modelo/política, ADK, proyectos | **0-uonify** | reescribir | alta |
| Voz Live (Gemini/Vertex Live, gateway, delivery) | **0-uonify** (+ substrato §3) | reescribir | alta |
| Herramientas/asignaciones/seguimientos del agente | **0-uonify** (vía MCP Gateway) | adaptar | alta |
| Puente creativo chat↔estudio | **0-uonify** (consume 2.4.3) | adaptar | media |
| Planificación creativa + contratos de generación (Veo/Imagen/Omni/Lyria/Chirp) | **2.4.3-product-content** | adaptar | media |
| Doble-puerta de dinero (cotización + dispatch) | **2.4.3 / transversal** (invariante a SSM + SQL) | adaptar | media |
| Coordinador de ejecución + assets/GCS + candidatos/revisión | **2.4.3-product-content** (+ substrato §3) | reescribir | media |
| Postproducción Craft + export | **2.4.3** (+ 2.4.4) | envolver/bloquear | baja |
| Fichas de producto / borradores / PIM / intake | **2.1.1-products** (reconciliar con `schema/017`) | adaptar | **alta** |
| Requisitos PTD y atributos | **2.1.3-attributes** (+ 2.4.4) | adaptar | media |
| GPSR (seguridad de producto UE) | **2.1.4-brands** (+ 2.1.1 + 2.4.4) | adaptar | media |
| Conexión Amazon (OAuth/LWA) + catálogo/listings/publicación/incidencias/A+ | **2.4.4-marketplaces** | reescribir/envolver | alta |
| Google Drive (OAuth + lectura/subida + extracción) | **2.8.4.3-drive** | envolver (lectores → contenedor) | alta |
| Onboarding incremental | **1.1-tenant-onboarding** | adaptar | alta |
| Identidad y acceso (Google OIDC) | **1.2.1-identity-access** (Cognito federa Google) | reescribir | media |
| Borrado de cuenta (self-service) | **1.2-platform-management** | adaptar | media |
| Consola admin (+ 2FA TOTP) | **1.2-platform-management** (+ 2.11-security + 1.2.4-audit-log) | adaptar | alta |
| Ajustes de cuenta + notificaciones | **1.2.3-tenant-configuration** (+ 1.2.5-notifications) | adaptar | media |
| Web pública y Centro de ayuda | **2.4.1-website** | adaptar | alta |
| Jev (gatekeeper de publicación) | **2.4.1-website** o **2.6.8-approvals** | envolver | baja |

## 2. Fuera de alcance de los 3 repos (excluir al subir)

- `backend/backend/` (residual vacío) · los `Dockerfile.*-overlay` (parches de imagen, incompatibles con SAM) · `local-blender/` y binarios Rust de Craft (herramienta local; destino Fargate/EC2 dedicado o utilidad local).

## 3. Números asignados por nosotros (lógica del arquitecto; a confirmar en PR)

Siguiendo la misma lógica de carpetas numeradas, proponemos para lo que hoy no tiene hueco:

| Capacidad Uonify | Número propuesto | Lógica |
|---|---|---|
| Substrato de ejecución durable (colas, workers, WebSocket de voz, media-workers, caché) | **1.4-runtime-substrate** | Es base técnica de plataforma → sigue a `1.3-app-shell` dentro de `1.0-platform-base`. Infra greenfield (SQS/StepFunctions/Fargate/WebSocket API/ElastiCache). |
| Suscripción SaaS de Uonify (cobro de la plataforma a sus tenants) | **1.2.6-subscription** | Es concern de plataforma (no del tenant) → sigue a `1.2.5-notifications` en `1.2-platform-management`. Distinto de `2.2-finance` (tesorería del tenant). |
| Conexión Google Cloud del cliente (BYO-Vertex: Veo/Gemini/Lyria) | **2.8.6-google-cloud** (alt.: bajo `0-uonify` como conexión de proveedor del cerebro) | Sigue el patrón de conectores externos de Productividad (`2.8.4-google-workspace`, `2.8.5-microsoft-365`). Marcado para decidir frontera con `0-uonify`. |

## 4. Secuencia

0. **Este PR**: ledger + mapeo de datos/infra (cero despliegue). · 1. **Vertical PIM money-neutral** `2.1.1-products` (calca `parties`). · 2. PIM + Marketplaces. · 3. Plataforma base (Drive, onboarding, identidad/admin). · 4. Cerebro `0-uonify`. · 5. **Estudio** `2.4.3` (último; PROD Google CERRADA).

## 5. Estado

| Fase | Estado |
|---|---|
| Ledger + mapeo (este PR) | en revisión |
| Vertical PIM `2.1.1-products` | pendiente |
| Resto | pendiente |
