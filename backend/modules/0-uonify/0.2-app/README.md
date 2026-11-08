# Aplicación Uonify

Objetivo específico: backend de la aplicación de Uonify que corre en https://dev.uonify.com (API y workers).

Responsabilidad: chat y voz de Uony, Estudio y postproducción ArtCraft, producto (ficha, materiales y GPSR), conexiones (Drive, Google Cloud y Amazon), cuenta y cobro, alta y consola de administración.
Estado: código copiado tal cual del `/app` de la imagen API que corre en DEV (08-11-2026). Fusionar en esta carpeta no despliega nada.

Antes de trabajar aquí, lee el README de [0-uonify](../README.md).

## Contrato y estado de esta capa

Código: 0.2. Nombre/ruta: `0-uonify/0.2-app`. Propietario funcional: Uonify; las decisiones de alcance y comportamiento las toma el Product Owner de Uonify. Capa: backend.

Contenido: `app/` (API FastAPI y workers), `tests/`, `tools/` y `requirements.lock`. Son 709 ficheros, idénticos byte a byte (sha256) al `/app` de la imagen API desplegada, que usan api, materials-worker, billing-worker y clips-worker. Las 139 migraciones de la base propia (001 a 142) viven en `mastererp-database/modules/0-uonify/0.2-app/migrations`; las nuevas empiezan en la 143 y las ya aplicadas no se editan nunca.

Línea CONV: el conversation-worker corre todavía otra imagen, la línea CONV, que difiere de esta copia en 260 ficheros. Se unificará en un paso propio, con prueba del chat y de la voz por la UI real.

Dependencias: PostgreSQL propio de DEV y servicios de Google (Vertex AI, Gemini y Drive). Los secretos viven solo en Parameter Store (`/uonify/dev/*`), nunca en git. Exclusiones: datos y recursos de otros módulos del ERP, que se consumen por contrato.

## Reglas de esta carpeta

- La fuente es este repo. Nunca se construye ni se despliega desde un árbol local; lo que corre se identifica por el digest de su imagen.
- Límite de 500 líneas: todo fichero nuevo o modificado tiene como máximo 500 líneas. La excepción del Product Owner (08-11-2026) cubre solo esta lista cerrada de ficheros, que ya corrían en DEV. Si se toca uno de ellos, se parte en ese mismo cambio y sale de la lista:
  - `app/creative_craft_launcher_postgres.py` (1.258), `app/creative_craft_physical_receipt_verifier.py` (1.135), `app/creative_execution_coordinator.py` (1.030), `app/creative_craft_input_authority.py` (985), `app/creative_craft_materializer.py` (984), `app/creative_craft_launcher.py` (827), `app/creative_project_state_projection.py` (671), `app/creative_craft_output_adoption_worker.py` (648), `app/creative_craft_materialization_orchestrator.py` (626), `app/creative_google_transport.py` (589), `app/creative_video_contracts.py` (574), `app/creative_craft_physical_receipt_contract.py` (542), `app/uony_live_router.py` (534) y `tests/test_uony_adk_agent.py` (754).
- Antes de diseñar o cambiar algo de Google ADK, Gemini/Live, Vertex AI, google-genai, Drive, OAuth o Google Cloud, se pide revisión técnica Google AI, y sin veredicto APROBADO no se implementa.
- No se reinicia ni se despliega el backend con un clip de pago en curso.
- Ramas, PR, comprobaciones y qué despliega cada fusión: README de 0-uonify.
