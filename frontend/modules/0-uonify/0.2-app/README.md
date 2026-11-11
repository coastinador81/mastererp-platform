# Aplicación Uonify

Carpeta `0.2-app` de la capa frontend. Antes de trabajar aquí, leer el [README de `0-uonify`](../README.md): sus Reglas comunes valen también para esta carpeta y aquí no se repiten.

Objetivo específico: la interfaz web de Uonify en `https://dev.uonify.com`.

Responsabilidad: el espacio de trabajo con Uony (chat y voz) y la interfaz de las áreas de la sección 2 de las Reglas comunes, mientras no se separen en 0.2.x. Además, la web pública y la ayuda, que no son un área de esa tabla y siguen en `0.2-app` mientras el dueño no decida otra cosa.

Estado: copia exacta de la web aprobada que sirve dev.uonify.com, en git desde `c4954c2` (PR #8, 08-11-2026), con el mismo sha256 por fichero que el árbol aprobado; la media de más de 1 MiB queda fuera de git (`media-fuera-de-git.sha256`). Su puerta y su publicación manual están en `edge/` desde el PR #9 (`59ae0eb`). Fusionar aquí no publica nada: se publica a mano (ver «Publicación en dev.uonify.com»).

## Contrato y estado de esta capa

Código: 0.2. Nombre/ruta: `0-uonify/0.2-app` (`frontend/modules/0-uonify/0.2-app`). Propietario funcional: Uonify, cuyas decisiones toma el dueño (Product Owner). Propietario de los datos: el backend de `0.2-app`; la web no guarda datos de negocio y la sesión es una cookie del backend.

Capa: frontend. Correspondencia: `backend/modules/0-uonify/0.2-app` y, en infrastructure y database, `modules/0-uonify/0.2-app`. Dependencias: la API del backend de `0.2-app`, en el mismo origen (rutas relativas `/api` y el WebSocket de la voz, `/api/uony/live`); la publicación y la puerta, en `edge/` de esta carpeta; los recursos AWS, en infrastructure `modules/0-uonify/0.2-app`. Exclusiones: no importa nada de fuera de su carpeta (ni la raíz de `0-uonify`, ni `frontend/app-shell`, ni `frontend/shared`) y nada de fuera importa de ella. APIs/eventos/MCP: los que publique el backend de `0.2-app`; ninguno se da por disponible solo porque exista esta carpeta.

Estado verificable: en `dev` 59ae0eb hay 1583 ficheros: los 1564 de la web, con el mismo sha256 que el árbol aprobado (sin la media de más de 1 MiB), los 16 de `edge/`, `media-fuera-de-git.sha256`, este README y `.gitignore`. `publish-uonify-dev.yml:36` excluye esta carpeta (D5). dev.uonify.com sirve el dist que el dueño aprobó el 07-11-2026, publicado a mano.

Validaciones: Reglas comunes, sección 10, más `npm run check` y `npm run build` en verde (mientras `check:contract` falle, se sigue «Trabajo local»).

## Qué hay

Copia exacta del árbol aprobado del que sale el dist publicado: React 19, TypeScript 6 y Vite 8, con React Router, TanStack Query y zustand; pruebas con Vitest, Testing Library y MSW (`package.json`).

- Configuración: `package.json`, `package-lock.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` y `eslint.config.js`.
- `src/`: 1448 ficheros (741 `.ts`, 583 `.tsx`, 122 `.css` y 2 `.json`); los 5 `README.md` internos del árbol local no se subieron. `scripts/`: `check-lines.mjs`, `check-live-contract.mjs`, `prerender.mjs` y `export-uony-mark.mjs`.
- `public/`: 104 ficheros, todos por debajo de 1 MiB salvo `assets/vendor/model-viewer-4.3.1.min.js`, que es código: está en git con su licencia (`model-viewer-LICENSE.txt`) y figura en la lista de excepción. Vite copia `public/` tal cual al dist, así que todo lo que esté ahí se publica: ni previews ni maquetas.
- La media de más de 1 MiB (37 ficheros: 30 PNG, 6 GLB y 1 MP4; 139 MiB) no está en git: vive en el bucket de la web y `media-fuera-de-git.sha256` guarda su sha256. Para un build completo, se restaura en su ruta y se comprueba con `shasum -a 256 -c media-fuera-de-git.sha256`. Esos 37 ficheros nunca se añaden a git.
- `edge/`: la puerta (`gate-default.js`, `gate-api.js` y su generador `build_gate.mjs`), las páginas legales sin JS (`edge/public-pages/`), la publicación (`upload_dist.mjs`, `deploy_edge.mjs`, `run_test_function.mjs` y `set_gate_credentials.sh`) y sus pruebas (`test_gate.mjs` y `test/`).
- No están en git `node_modules/`, `dist/`, los `.env*` (solo podría entrar un `.env.example` con valores falsos), los artefactos de QA `__qa_*`, ni `AGENTS.md`, `CONVENTIONS.md`, `README.md` ni `docs/` del árbol local: sus reglas vigentes están en este README.
- En `0.2-app` ninguna carpeta empieza por un dígito ni se llama `screens` (Reglas comunes, sección 11; comprobado en `dev` 59ae0eb).
- Antes del PR, desde `0.2-app`: `git ls-files public | while read -r f; do [ "$(wc -c < "$f")" -gt 1048576 ] && echo "$f"; done` solo puede devolver la librería de la lista de excepción.

## Trabajo local

- `npm ci` y `npm run dev`: http://127.0.0.1:5173, puerto fijo; `/api` y su WebSocket van por proxy a la API local en `127.0.0.1:8000` (`vite.config.ts`). `npm run preview` sirve en 127.0.0.1:4173. Servidores locales, solo en 127.0.0.1.
- `npm run check` encadena `check:lines`, `check:contract`, `typecheck`, `lint` y `test` (Vitest, 244 ficheros de prueba). Tiene que quedar en verde antes de dar algo por hecho y antes de cada PR.
- Mientras `scripts/check-live-contract.mjs` no apunte al backend de `0.2-app` (Pendientes), `npm run check` falla en `check:contract`. Ese ajuste va en un PR propio, antes que cualquier otro cambio de la web. Hasta que se fusione, antes de cada PR se pasan `npm run check:lines`, `npm run typecheck`, `npm run lint` y `npm run test`; el PR dice que `check:contract` está pendiente, y no se cambian `LIVE_WORK_INTENTS` ni el `Action` del backend.
- `npm run build` = `tsc -b` + `vite build` + prerender de la web pública (`postbuild`, `scripts/prerender.mjs`), que escribe además `robots.txt` y `sitemap.xml`.

## Reglas de la web

Normas del dueño para su frontend, que se suman a las Reglas comunes.

- Conversación primero: todo se inicia, completa y revisa desde el chat de Uony. Las preguntas ordinarias van en texto; un formulario, solo si el cliente lo pide o hace falta una selección estructurada. Conexiones, revisiones y aprobaciones, con tarjetas o diálogos en ese contexto; las autorizaciones externas vuelven al hilo. Los módulos son una vista manual opcional sobre los mismos datos: ningún flujo obliga a ir a un módulo ni presenta como real lo simulado.
- Preguntas y progreso de Uony: un solo indicador activo sobre el compositor; una pregunta guardada se reabre tras comprobar su vigencia por GET; una ejecución nunca se repite sola, y un resultado desconocido exige aceptar el posible consumo adicional antes de repetir.
- Aspecto: además de la sección 9 de las Reglas comunes, una aprobación funcional no autoriza a rediseñar, y volver a un aspecto anterior no autoriza a crear otro.
- Marca: la IA se llama Uony; sus acciones dicen «… con Uony» y llevan `<Icon name="uony">`; aqua solo para lo que hace Uony; un solo botón sólido por vista; colores solo con los tokens de `src/shared/styles/tokens.css`, sin hex sueltos en CSS nuevo.
- Textos definitivos en español de España, sin notas de «pendiente de revisión». Preguntas en lenguaje llano. Identificadores, rutas de datos, hashes, versiones y expresiones de validación no se muestran.
- Aclaraciones opcionales con `InformationDisclosure` (`@/shared/ui`), cerrado por defecto. Siempre visibles: errores accionables, costes antes de confirmar, condiciones de consentimiento y revisión de envíos.
- Accesible (roles y nombres correctos, foco visible y devuelto al cerrar diálogos, `prefers-reduced-motion`) y responsive de 360 px a escritorio, sin scroll horizontal.
- Sin indexar hasta el lanzamiento: `index.html` lleva `noindex, nofollow` y el prerender escribe un `robots.txt` con `Disallow: /`. Solo `VITE_INDEXING=true` lo abre, y eso llega con el lanzamiento, que decide el dueño.
- Datos: toda llamada pasa por `@/shared/api/client` con rutas relativas a `/api`. Estado de servidor con TanStack Query; de interfaz, con React, y zustand solo si lo comparten componentes lejanos.
- MSW solo en pruebas o con `VITE_USE_MOCKS=true` explícito; nunca sustituye a una operación real que falla.
- Nada valioso en el navegador (Reglas comunes, sección 8): tampoco claves ni tokens de terceros, porque la sesión es una cookie del backend. Toda variable `VITE_*` acaba en el JavaScript que se descarga.
- Estructura: `src/app` (arranque, proveedores y router; no se toca para añadir un módulo), `src/shared` (cliente HTTP, kit `ui`, estilos…) y `src/modules/<módulo>`, cuyo `index.ts` es su única puerta. Un módulo solo importa otro por su `index.ts` (ESLint lo impide) y `shared/` no importa de `modules/`. Rutas y simulaciones se registran solas con `import.meta.glob`.
- Código: TypeScript estricto (`tsconfig.app.json`), `any` solo con un comentario que lo justifique; un componente por archivo; lógica pura en `model/` con pruebas; llamadas en `api/`; comentarios breves en español que expliquen el porqué.
- 500 líneas: `npm run check:lines` comprueba los `.ts`, `.tsx` y `.css` de `src/`, y ESLint `max-lines`, el TypeScript. `scripts/`, `edge/` y `public/` se comprueban con la orden de la sección 10 de las Reglas comunes.
- Contrato de voz: `npm run check:contract` exige que cada acción de `Action` en el backend (`app/uony_semantic_decision.py`) esté en `LIVE_WORK_INTENTS` (`src/modules/workspace/api/liveTransport.ts`); si falta una, el navegador toma el aviso por un error de protocolo y corta la voz. Un cambio en cualquiera de los dos lados pasa este check en el mismo PR.
- Aceptación: el recorrido completo se demuestra desde el chat de Uony, sin exigir ir al módulo; el modo manual comparte datos y permisos, volver o recargar conserva el trabajo, y los errores o reintentos no duplican operaciones.

## Identidad visual: excepción del dueño

- El [estándar UX/UI](../../../../docs/UX_UI_STANDARD.md) es la referencia de las interfaces administrativas de los módulos de MasterERP (`:7`). Para Uonify/chat, POS y la tienda admite otra composición, pero pide reutilizar su identidad y sus componentes compatibles (`:11`), y los README no definen otra identidad visual (`:3`; `AGENTS.md:60`).
- Excepción del dueño, según `AGENTS.md:32`: `0.2-app` conserva la identidad que él aprobó, no la de la guía (Inter alojada en el proyecto, fondo `#F6F8FC`, menú blanco, texto `#4B5563`, tablas de 14 px en `#667085`). Alcance: solo esta carpeta; la app integrada de la raíz sigue el estándar. Aquí no se importan las hojas `--finance-*` ni la clase `.finance-app` (`:50`).
- Identidad aprobada: la de `src/shared/styles/tokens.css` (colores, radios y tipografía) y las fuentes que carga `index.html`; sus valores no se copian aquí (`docs/UX_UI_STANDARD.md:3`).
- Canon (dueño, 08-11-2026): el [manual de identidad corporativa](../identidad-corporativa/Uonify_Identidad_Corporativa.pdf) rige todo lo visual de esta carpeta y prevalece sobre la guía (Reglas comunes, sección 3). Antes de tocar diseño o UX/UI se lee; no se inventan diseños, estilos ni patrones nuevos; lo que el manual no cubra lo decide el dueño, y un cambio visual que no lo cumpla no se fusiona.
- Lo aprobado es la web que sirve hoy dev.uonify.com: cualquier cambio visual cumple el manual y necesita antes la aprobación del dueño (Reglas comunes, sección 9).

## Variables de compilación

| Variable | Qué hace | Receta del dist aprobado |
| --- | --- | --- |
| `VITE_SITE_URL` | URL canónica del prerender, `robots.txt` y `sitemap.xml` | `https://dev.uonify.com` |
| `VITE_INDEXING` | `true` abre la indexación | Quitada del entorno |
| `VITE_USE_MOCKS` | `true` activa MSW en el navegador | Quitada del entorno |
| `VITE_ESTUDIO_CLIP_WIRING` | `true` enciende en el chat el cableado del clip simple del Estudio | Quitada del entorno |
| `VITE_API_BASE` | Base de la API; por defecto, `/api` | No la fija |
| `VITE_REVIEW_MODE` | `true` solo en la versión de revisión de OpenAI: etiqueta «Simulado» | No la fija |

El dist aprobado se compiló con `VITE_SITE_URL=https://dev.uonify.com npm run build` y esas tres variables quitadas del entorno (40 páginas prerenderizadas, noindex). Vite lee además los `.env*` de la carpeta, que no están en git y pueden fijar cualquiera de ellas; un clon de `dev` no tiene ninguno, y la orden del paso 2 de «Publicación» las fija de forma explícita.

## Publicación en dev.uonify.com

Decisión del dueño (08-11-2026, `b555b94`): se publica a mano, con su usuario de AWS, desde un clon de este repo en `dev`, nunca desde un árbol local suelto, y solo tras su OK visual. GitHub no publica: no hay workflow ni rol de CI, y crearlos lo decide el dueño. Desde esta carpeta:

1. Media: restaurar los ficheros de `media-fuera-de-git.sha256` desde el bucket `uonify-dev-web-277352717693` (clave = ruta sin `public/`) y comprobarlos con `shasum -a 256 -c media-fuera-de-git.sha256`.
2. `npm ci` y, sin `VITE_USE_MOCKS`, `VITE_INDEXING` ni `VITE_ESTUDIO_CLIP_WIRING` en el entorno, `VITE_SITE_URL=https://dev.uonify.com npm run build`.
3. Puerta: `node edge/build_gate.mjs --dist dist --root-gated --write`; si cambian `edge/gate-default.js` o `edge/public-pages/`, van por PR. Después, `node edge/test_gate.mjs`, con `GATE_DIST`, `GATE_FRONT_SRC`, `GATE_BACKEND_SRC` y `GATE_ACORN` apuntando a `dist`, `src`, `backend/modules/0-uonify/0.2-app/app` y `node_modules/acorn`: tiene que dar 82/82.
4. Ensayo, sin `--apply`: `node edge/upload_dist.mjs --dist dist`, lo mismo con `--root`, y `node edge/deploy_edge.mjs legal`.
5. Publicar: `node edge/upload_dist.mjs --dist dist --apply`; si cambió la puerta, `node edge/deploy_edge.mjs functions --apply` y `publish --apply`; después, `upload_dist.mjs --dist dist --root --apply` y `deploy_edge.mjs legal --apply`.
6. Verificar: `node edge/deploy_edge.mjs verify` y prueba por la UI real, con evidencia (Reglas comunes, sección 9).

- Solo en `https://dev.uonify.com`, detrás de la puerta de acceso de DEV: el JavaScript de la app nunca queda público. Nunca con el workflow ni el hosting del equipo.
- Excepción del dueño del 10-11-2026, ya cerrada:
  - Para un demo abrió DEV a cualquiera: la puerta de la web en vivo dejaba pasar todas las páginas (un cambio a mano del equipo) y `API_OPEN = true`.
  - El 11-11-2026 ordenó volver a cerrarlo: «devuelve el candado que tenía». Se desplegaron las dos funciones de este repo (`deploy_edge.mjs functions` y `publish`), con `API_OPEN = false` y la puerta de la web de git.
  - Si se vuelve a abrir, ver el historial de este apartado.
- `upload_dist.mjs` comprueba cada objeto que sube (sha256, tipo y caché) e invalida la caché de CloudFront. No sube el chunk de MSW (`assets/browser-*.js`), `mockServiceWorker.js`, los `.md` ni `.DS_Store`.
- Se niega a subir si la puerta no se generó para ese dist (`build_gate.mjs --check`): si cambian las rutas prerenderizadas o lo que piden las páginas públicas, primero se regenera y se publica la puerta.
- La portada (`index.html` raíz) solo se sube con `--root` y con la puerta cerrando ya «/».
- Las credenciales de la puerta las pone solo el dueño, con `edge/set_gate_credentials.sh`; los cambios de la distribución se hacen con `edge/deploy_edge.mjs`.
- ⚠ Publicar nunca borra del bucket: la media pesada solo vive allí, y el bucket guarda versiones.

## Excepción de 500 líneas de esta capa (D3)

Lista cerrada (reglas en la sección 3 de las Reglas comunes), con los dos ficheros de `edge/` que llegaron sin partir:

| Fichero | Líneas | Motivo |
| --- | --- | --- |
| `public/assets/vendor/model-viewer-4.3.1.min.js` | 1118 | Librería de terceros minificada (`@google/model-viewer` 4.3.1), copia exacta; su sha256 empieza por `283b06723846` |
| `edge/test_gate.mjs` | 939 | ⚠ Fuera de D3 por la letra: no es copia exacta (en DEV, `ce8725c2d73a`; aquí, `8d680682715c`: solo cambia el usuario de prueba, ahora ficticio) y entró sin partir (en infrastructure con el PR #4; aquí, con el PR #9). Se parte en el siguiente cambio de `edge/` |
| `edge/deploy_edge.mjs` | 793 | Despliegue del borde de dev.uonify.com. Copia exacta (`bac84f73599b`), trasladada desde infrastructure en el PR #9 sin partir. Por la letra de D3, se parte en el siguiente cambio de `edge/`, salvo que el dueño acepte que un traslado sin cambios no cuenta como tocarlo |

La librería no se edita: para cambiar de versión no entra otro fichero de más de 500 líneas, y cómo cargarla se decide con el dueño (`@google/model-viewer` ya está en `package.json`). En `src/`, `scripts/` y el resto de `edge/`, ningún fichero pasa de 500 líneas (comprobado en `dev` 59ae0eb). `package-lock.json` (4688 líneas) es un fichero de bloqueo generado y no cuenta (`docs/DEVELOPMENT_STANDARD.md:5-7`).

## Pendientes

- `scripts/check-live-contract.mjs:8` lee `../../backend/app/uony_semantic_decision.py`, que desde `scripts/` no existe: hoy `npm run check` falla en `check:contract`. Se corrige en un PR propio, antes que cualquier otro cambio de la web, para que lea `../../../../../backend/modules/0-uonify/0.2-app/app/uony_semantic_decision.py` (desde la raíz del repo, `backend/modules/0-uonify/0.2-app/app/uony_semantic_decision.py`).
- ⚠ `edge/test/fixtures/e4n1-config.json` es la copia real de E4N1 del 07-11 (sin el secreto de origen, que aún no existía): hay que sustituirla por una sintética (Reglas comunes, sección 8). La leen `edge/test/deploy_tests.mjs:20` y `:260`.
- `edge/test_gate.mjs` llegó con una línea cambiada y sin partir: se parte en el siguiente cambio de `edge/` (excepción de 500 líneas, arriba).
- Confirmar con el dueño que el nombre y el correo de `src/modules/settings/mocks/store.ts:28` son ficticios; si no lo son, se sustituyen por datos de `example.test` en un cambio propio. Los datos simulados usan siempre dominios reservados (`example.test`).
- Los 5 `README.md` internos de `src/` y los 5 `.md` de `public/` del árbol aprobado no se subieron: decide el dueño si entran.
- Acceso: hoy se entra con Google directo y sesión en cookie del backend; el contrato del equipo pide Cognito (`docs/FRONTEND_ARCHITECTURE.md:17` y `:23`). Sigue como excepción D6 (Reglas comunes, sección 3).
- El lanzador del equipo enlaza su «Chat principal» a `https://dev.uonify.com/` (`frontend/shared/module-launcher/module-launcher.mjs:3` y `2.2-finance/src/UonifyChatLink.jsx:5`): qué ve ese usuario al llegar a la puerta de DEV lo decide el dueño con el arquitecto.
