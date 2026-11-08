# Aplicación Uonify

Antes de trabajar aquí, leer el [README de 0-uonify](../README.md): sus Reglas comunes y sus reglas de backend valen para esta carpeta y aquí no se repiten.

Objetivo específico: el backend de la app de Uonify que se sirve en https://dev.uonify.com (API y workers).

Responsabilidad: Uony (chat y voz), Estudio y postproducción ArtCraft, producto (ficha, materiales y GPSR), conexiones (Drive, Google Cloud y Amazon), cuenta y cobro, alta y consola de administración.
Estado: copia exacta del código de la imagen API de DEV, en git desde `7608ad5` (PR #7, 08-11-2026). Faltan la línea CONV y el `Dockerfile`: desde aquí todavía no se construye ni se despliega nada.

## Contrato y estado de esta capa

Código: 0.2. Nombre/ruta: `0-uonify/0.2-app`. Propietario funcional: Uonify, cuyas decisiones toma el dueño (Product Owner). Propietario de los datos: Uonify, en su PostgreSQL propio de DEV (D6).

Capa: backend. Gemelas: `frontend/modules/0-uonify/0.2-app` (web), infrastructure `modules/0-uonify/0.2-app` (host, compose y borde de DEV) y database `modules/0-uonify/0.2-app/migrations` (D4).

Dependencias: PostgreSQL 17 y Redis 7.4 propios; Google (inicio de sesión OIDC, Drive, Google Cloud y Vertex AI); Stripe en modo de pruebas; Amazon SP-API (sin credenciales en DEV); Mailpit, que retiene el correo de DEV. Exclusiones: Cognito, `backend/shared` y cualquier otro recurso del equipo.

APIs/eventos/MCP: HTTP bajo `https://dev.uonify.com/api/*` y voz por WebSocket en `/api/uony/live`, detrás de CloudFront y del nginx de la EC2. Sin OpenAPI público (`app/main.py:72`), eventos ni MCP.

Estado verificable (08-11-2026): `app/` (455 ficheros .py), `tests/` (251), `tools/` (2) y `requirements.lock` (73 dependencias) coinciden fichero a fichero con el `/app` de la imagen de ECR `uonify-dev/api@sha256:7e3743d0cbc9…` (etiqueta `devorigin-20261107`; en local, `uonify-dev-api:devorigin-20261107`), sin cachés de Python. `uonify-dev/clips` lleva el mismo `/app`.

Validaciones: ver «Comprobaciones de esta carpeta».

## Qué hay

- `app/`: API FastAPI y workers, en módulos planos, sin subcarpetas.
- `tests/`: pruebas pytest. `tools/`: dos sondas de QA (carga de la cola de conversación y recuperación de materiales) sobre un esquema desechable. `qa04_product_recovery_probe.py` no comprueba el destino: solo contra un PostgreSQL desechable.
- `requirements.lock`: las versiones fijadas de la imagen.
- Sin `migrations/` (viven en database, D4) ni `Dockerfile` (ver Pendientes).
- La copia sale del `/app` de la imagen, nunca de un árbol local; los 272 `.pyc` que trae la imagen no se versionan.

## Áreas (orientativo: manda el código)

Hasta que su código se separe en 0.2.1, 0.2.2… (ver Reglas comunes, sección 2), cada área es un grupo de prefijos de `app/`.

| Área | Ficheros de `app/` | Rutas |
| --- | --- | --- |
| Uony: cerebro y voz | `uony_*` (93; la voz, `uony_live_*`), `conversation_forms.py`, `connection_tools.py`, `run_conversation_worker.py` | `/api/uony`; voz en `/api/uony/live` |
| Estudio y postproducción ArtCraft | `creative_*` (192), `craft_*`, `run_clips_only_worker.py`, `recover_clip_from_staging_cli.py`, `requeue_failed_internal_step_cli.py` | `/api/uony/threads/{thread_id}/creative-*` y `…/estudio`; `/api/uony/estudio` |
| Producto: ficha, materiales y GPSR | `product_*` (63), `products.py`, `brands.py`, `brand_gpsr_store.py`, `gpsr_capture.py`, `drive_*` (lectores de materiales), `native_blend_reader.py`, `run_material_worker.py` | `/api/products`, `/api/brands`, `/api/uony/product-intakes` |
| Conexiones: Drive, Google Cloud y Amazon | `google_*` (18), `amazon_*` (16), `incident_*`, `blender_*`, `cloud_popup.py`, `run_amazon_gateway.py` | `/api/connections/*`, `/api/product-incidents`, `/api/blender-agent` |
| Cuenta y cobro | `account_*`, `billing_*`, `subscription.py`, `stripe_provider.py`, `access.py` | `/api/billing`, `/api/account/deletion` |
| Alta | `onboarding*`, `auth.py`, `google.py` | `/api/onboarding`, `/api/auth` |
| Consola de administración | `admin_*` | `/api/admin/auth` |
| Común | `main.py`, `run.py`, `settings.py`, `database.py`, `security.py` | `/api/health` |

## Cómo corre hoy en DEV

Docker Compose en la EC2 arm64 de eu-west-1 (stack `uonify-dev-backend`), definido en infrastructure `modules/0-uonify/0.2-app/host/runtime/compose.yaml`. nginx recibe de CloudFront `/api/*` y la voz y los pasa a `api:8000`.

| Servicio | Imagen ECR, fijada por digest | Comando |
| --- | --- | --- |
| `api` | `uonify-dev/api` | `python -m app.run` (uvicorn en el puerto interno 8000) |
| `materials-worker` | `uonify-dev/api` | `python -m app.run_material_worker` |
| `billing-worker` | `uonify-dev/api` | `python -m app.billing_worker` |
| `clips-worker` | `uonify-dev/clips`, con el mismo `/app` | `python -m app.run_clips_only_worker` (perfil `armed`) |
| `conversation-worker` | `uonify-dev/conv`, la línea CONV (ver Pendientes) | `python -m app.run_conversation_worker` |

Junto a ellos corren `db` (PostgreSQL 17), `redis` (7.4.7), `mailpit` y `nginx`. api y workers usan el usuario 1000, raíz de solo lectura y ninguna capacidad: el código solo puede escribir en sus tmpfs, como `/tmp`. Sus logs van a CloudWatch (`/uonify/dev/api` y `/uonify/dev/workers`).

Configuración no secreta por variables de entorno (`UONIFY_ORIGIN`, `UONIFY_SESSION_REDIS_URL`, `UONIFY_TEST_*`, `UONIFY_CREATIVE_OUTPUT_*`…; `PGHOST` vale `db` por defecto). Secretos solo como ficheros de `UONIFY_SECRETS_DIR` (por defecto `/run/uonify`, `app/settings.py:96`), leídos al arrancar; en DEV los escribe `uonify-secrets-sync` desde Parameter Store. Sin `google-oauth.json`, `postgres-password` y `encryption-key` no arranca ningún proceso (`app/settings.py:97` y `:177-178`).

## Versiones fijadas (imagen API)

| Pieza | Versión |
| --- | --- |
| Python | 3.12.15, en Debian 13 «trixie» arm64 (imagen base) |
| FastAPI / Starlette / Uvicorn | 0.141.1 / 1.7.0 / 0.54.0 |
| Pydantic | 2.13.5 |
| google-adk | 2.12.0 |
| google-genai / google-auth | 2.31.0 / 2.61.0 |
| Driver de PostgreSQL | psycopg 3.3.6, con psycopg-binary |
| redis / websockets / httpx | 6.4.0 / 15.0.1 / 0.28.1 |
| pytest | 9.1.1 |
| Paquetes del sistema | tesseract-ocr (eng, spa, fra, deu, ita y por), ghostscript, libcairo2, libseccomp2 y fonts-dejavu-core |

Las 73 versiones están en `requirements.lock`, un fichero de bloqueo generado: no cuenta para las 500 líneas y no se edita a mano (`docs/DEVELOPMENT_STANDARD.md:5-7`). Subir google-adk o google-genai pasa antes por la revisión técnica Google AI.

## Migraciones (base propia)

- Viven en database `modules/0-uonify/0.2-app/migrations` (D4): 139 ficheros, de `001_identity.sql` a `142_creative_clip_drive_deliveries.sql`, idénticos a los de la imagen. Ningún pipeline las ejecuta y nunca van a la RDS compartida.
- Las aplica nuestro código al arrancar: la API en su `lifespan` (`app/main.py:69`) y cada worker al empezar (por ejemplo, `app/run_conversation_worker.py:27`). `Database.migrate()` (`app/database.py:14-27`) toma un bloqueo consultivo, recorre en orden `migrations/*.sql` junto a `app/` (línea 18) y guarda el sha256 de cada fichero en `schema_migrations`.
- ⚠ Una migración aplicada no se edita nunca: si cambia su sha256, el proceso no arranca («Una migración aplicada ha cambiado», `app/database.py:23-24`). Cada corrección es una migración nueva.
- Las nuevas empiezan en la 143. Su PR en database se fusiona el mismo día que el PR del código que la usa.
- ⚠ `PGHOST` solo apunta a la base propia (`db` en el compose; `app/settings.py:176`). Contra otra base, el arranque crearía allí todas nuestras tablas, también las de conversaciones, que la base del equipo no admite (database `documentation/onboarding-data-model.md:9`).

## Reglas de esta carpeta

- Fuente única: este repo. Lo que solo existe fuera de git (un árbol local, copias de trabajo) entra por partes, cada una en un PR pequeño y probado por la UI, nunca como base.
- Mientras falten el `Dockerfile` y la publicación de la imagen desde este repo (Pendientes), no se fusiona en `dev` ningún cambio de `app/`, `tests/` ni `requirements.lock`, ni migraciones nuevas en database: no se podrían probar por la UI real y git dejaría de ser igual que DEV. El siguiente cambio de código de esta carpeta es el `Dockerfile`. Única excepción: quitar la dirección real de `app/admin_set_password.py:6` (Pendientes), que no cambia el comportamiento.
- Despliegue solo por digest: DEV corre imágenes de ECR fijadas por `sha256` en `/etc/uonify/compose.env` de la EC2, nunca por etiqueta ni construidas en el host. Tras desplegar, se comprueba el sha256 de los ficheros dentro del contenedor contra el commit.
- ⚠ No se recrea ni se reinicia `api` ni `clips-worker` con un clip de pago en curso. Antes, comprobar en la base que no hay filas `running` en `creative_execution_attempts` ni `reserved` en `creative_generation_attempts`.
- El motor de clips se queda armado (`app/creative_google_dispatch_gate.py:26`): el dinero lo protege la doble puerta, ese interruptor más la confirmación explícita del cliente en cada clip, no apagarlo (dueño, 31-10-2026).
- Gasto en piloto: ADK, voz Live y Estudio se abren por listas de usuarios en `/run/uonify` (`app/settings.py:160-169`), y el Estudio no cotiza ni gasta sin una tarifa vigente de menos de 24 h (`creative-clips-only-rate-snapshots.json`; ver `app/creative_clips_only_rate_snapshots.py`). Listas y tarifa las decide el dueño.
- Revisión técnica Google AI (ver Reglas comunes, sección 9) antes de tocar `uony_adk_*`, `uony_live_*`, `creative_google_*`, `google_*`, `drive_read_tools.py` o las versiones de google-adk y google-genai.
- Contrato de voz con la web: cada valor de `Action` (`app/uony_semantic_decision.py`), salvo `conversation`, que nunca llega como aviso, tiene que estar en `LIVE_WORK_INTENTS` de `frontend/modules/0-uonify/0.2-app/src/modules/workspace/api/liveTransport.ts`. Si falta, el navegador toma el aviso por un error y corta la voz. Por eso, un cambio de `Action` lleva en el mismo PR el cambio de la web y `npm run check:contract` en verde (ver el README de la web). ⚠ Hoy ese check no encuentra el backend en este repo: `scripts/check-live-contract.mjs:8` de la web lo busca en `../../backend/app/`, la ruta del árbol local. Hasta que la web lo corrija, las dos listas se comparan a mano.
- Origen: la API solo arranca con `UONIFY_ORIGIN` igual a `https://dev.uonify.com` o al local `http://127.0.0.1:5173` (`app/settings.py:101-102`). No se añaden orígenes sin decisión del dueño.
- El acceso simple de administración (`UONIFY_ADMIN_DEV_SIMPLE_LOGIN`) solo funciona con origen local (`app/settings.py:202-204`); en DEV no se activa.
- Lo que el backend manda a la interfaz (respuestas de Uony, mensajes y tarjetas) también es «lo que se ve»: cambiarlo necesita la aprobación visual del dueño.
- Uony primero (dueño, 18-10-2026): la conversación con Uony es la vía principal para iniciar, completar y revisar cualquier operación, sobre este mismo backend; un flujo no está terminado sin probar su recorrido conversacional por la UI real.

## Comprobaciones de esta carpeta

Además de la sección 10 de Reglas comunes:

1. Pruebas del área tocada: `python -m pytest tests/test_<prefijo>*.py` (por ejemplo, `tests/test_creative_*.py`), en un contenedor desechable de la imagen, fuera del compose de DEV, o con `requirements.lock`.
   - ⚠ Nunca con `docker compose exec` o `run` en la EC2: allí `PGHOST` vale `db`, que es la base de DEV, y `/run/uonify` tiene los secretos reales.
   - En un clon, `migrations/` no está junto a `app/` (D4). Antes de probar, desde `0.2-app`: `ln -s <clon de mastererp-database>/modules/0-uonify/0.2-app/migrations migrations`, con la ruta absoluta del clon. Ese enlace nunca se versiona.
   - Las que usan el fixture `environment` necesitan un PostgreSQL desechable en `PGHOST`, con base y usuario `uonify`, y ficheros de secretos falsos en `UONIFY_SECRETS_DIR`: `tests/conftest.py` crea y borra un esquema `test_<uuid>` por prueba. Nunca contra la base de DEV.
2. Escaneo de secretos: estas coincidencias ya se revisaron el 08-11 y no son secretos: prefijos de tipo de clave en `app/billing_diagnostics.py:40` y `app/stripe_provider.py:57`, y valores falsos en `tests/test_checkout_diagnostics.py` y `tests/test_google_setup_diagnostics.py`. Cualquier otra coincidencia detiene el PR. Correos: `app/admin_set_password.py:6` lleva en su ejemplo de uso una dirección real de una persona (ver Pendientes). Cualquier otra que no sea genérica o de `example.test` detiene el PR.
3. Tras desplegar: digest y sha256 dentro del contenedor, `/api/health` correcto y prueba por la UI real con evidencia.

## Lista cerrada de excepción de 500 líneas (D3)

Ficheros que ya corrían en DEV y llegaron como copia exacta; líneas contadas con `awk 'END{print NR}'` y sha256 abreviado. La lista no crece: quien toque uno lo parte en ese mismo cambio y lo quita de aquí.

| Fichero | Líneas | sha256 |
| --- | ---: | --- |
| `app/creative_craft_launcher_postgres.py` | 1258 | `1f5563b439fe` |
| `app/creative_craft_physical_receipt_verifier.py` | 1135 | `82f9f73f231f` |
| `app/creative_execution_coordinator.py` | 1030 | `a55641cc67c4` |
| `app/creative_craft_input_authority.py` | 985 | `389885d34ab1` |
| `app/creative_craft_materializer.py` | 984 | `f22f30ee66ea` |
| `app/creative_craft_launcher.py` | 827 | `02d470755699` |
| `app/creative_project_state_projection.py` | 671 | `a2b2960ece59` |
| `app/creative_craft_output_adoption_worker.py` | 648 | `167b75e9d1ae` |
| `app/creative_craft_materialization_orchestrator.py` | 626 | `5f20981c88aa` |
| `app/creative_google_transport.py` | 589 | `ae5e4415df38` |
| `app/creative_video_contracts.py` | 574 | `8c42509b1900` |
| `app/creative_craft_physical_receipt_contract.py` | 542 | `ad57c846ec80` |
| `app/uony_live_router.py` | 534 | `203c992ebd26` |
| `tests/test_uony_adk_agent.py` | 754 | `a58a5a832929` |
| `tests/test_creative_execution_admission.py`, solo en la línea CONV (aún no está aquí) | 507 | `0434ac5f11ad` |

Las 7 migraciones de más de 500 líneas están en la lista de database.

## Pendientes

- Sustituir la dirección real del ejemplo de uso de `app/admin_set_password.py:6` por `persona@uonify.com`, como en `app/admin_setup.py:7`, en un cambio propio. Ese fichero dejará de coincidir con la imagen hasta la siguiente. El historial de git conserva la dirección.
- `Dockerfile` y `.dockerignore` que reproduzcan la imagen: misma base fijada por digest y mismos paquetes del sistema. La imagen necesita `/app/migrations` (`app/database.py:18`), y dos pruebas buscan `migrations/` junto a `app/` (`tests/test_uony_conversation_queue.py:416` y `tests/test_uony_live_drive_instruction.py:113`). Con D4 viven en database: el build y las pruebas tendrán que traerlas de allí, sin duplicarlas aquí.
- Build y publicación de la imagen desde un clon de este repo en `dev`: hoy las imágenes de DEV se construyeron fuera de git y no hay CI hacia ECR. Cómo se publica (a mano con el usuario de AWS del dueño, como la web, o con una CI) lo decide el dueño; no se crea un rol ni un workflow de CI sin que él lo pida. Mientras falte, un cambio en `app/` no llega a DEV ni se puede probar por la UI, y git y DEV se separarían.
- Línea CONV: `conversation-worker` corre `uonify-dev/conv`, cuyo `/app` difiere de esta copia en 260 ficheros: 58 con distinto contenido (41 de `app/` y 17 de `tests/`), 179 que solo tiene la API (148 módulos y 31 migraciones) y 23 pruebas que solo tiene la CONV (comparado el 08-11, sin cachés). Unificarla es un paso propio, con prueba del chat y de la voz por la UI real; mientras, sigue corriendo por digest.
- Pruebas desfasadas: en la imagen, lo más reciente de `tests/` es del 18-10 y 286 módulos de `app/` son posteriores (fechas de los ficheros); `tests/test_uony_live_adk_probe.py` importa `app.uony_live_adk_probe`, que no existe. Se reconcilian en un cambio propio antes de usarlas como comprobación.
