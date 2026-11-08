# Aplicación Uonify

Objetivo específico: web de la aplicación de Uonify que se publica en https://dev.uonify.com.

Responsabilidad: interfaz de Uony (chat y voz), Estudio, producto, conexiones, cuenta y cobro, alta, ayuda y web pública.
Estado: código de la web aprobada copiado tal cual del árbol que se publica en dev.uonify.com (08-11-2026). Se publica desde GitHub con `.github/workflows/publish-uonify-web-dev.yml` (ver «Publicación»).

Antes de trabajar aquí, lee el README de [0-uonify](../README.md).

## Contrato y estado de esta capa

Código: 0.2. Nombre/ruta: `0-uonify/0.2-app`. Propietario funcional: Uonify; las decisiones de alcance, comportamiento y aspecto las toma el Product Owner de Uonify. Capa: frontend. Dependencias: backend de `backend/modules/0-uonify/0.2-app`, llamado siempre por rutas relativas `/api`.

Contenido: React con TypeScript y Vite (`package.json`, `package-lock.json`, `src/`, `public/`, `scripts/` y configuración). Son 1.565 ficheros idénticos (sha256) a la web aprobada. Además, `edge/` lleva la puerta de dev.uonify.com: las CloudFront Functions `gate-default.js` y `gate-api.js`, su generador `build_gate.mjs`, las páginas legales sin JS de `edge/public-pages/`, los scripts de publicación y sus pruebas.

Media fuera de git: los 37 ficheros de más de 1 MiB (imágenes, modelos 3D y vídeo; 139 MiB) ya están publicados en el bucket de la web y no se suben. `media-fuera-de-git.sha256` los lista con su sha256: para un build completo, hay que restaurarlos en su ruta y comprobarlos con `shasum -a 256 -c media-fuera-de-git.sha256`.

## Reglas de esta carpeta

- ⚠ La raíz de `frontend/modules/0-uonify` es la app del equipo MasterERP y no se toca. Su workflow `publish-uonify-dev.yml` excluye `frontend/modules/0-uonify/0.2-app/**`, así que los cambios aquí no la republican.
- Aprobación visual previa del Product Owner para cualquier cambio de lo que se ve. Lo aprobado sigue publicado hasta que él apruebe lo nuevo.
- Nada valioso en el navegador: ni claves, ni precios internos, ni identificadores de proveedor. Las llamadas al backend van siempre por `/api` relativo.
- TypeScript estricto. Todo fichero nuevo o modificado tiene como máximo 500 líneas. La excepción del Product Owner (08-11-2026) cubre solo `public/assets/vendor/model-viewer-4.3.1.min.js` (1.118 líneas, librería de terceros), `edge/test_gate.mjs` (939) y `edge/deploy_edge.mjs` (793). Si se toca uno de los dos últimos, se parte en ese mismo cambio.

## Publicación (dev.uonify.com)

- **Push a `dev`** que toque esta carpeta: el workflow solo ENSAYA. Restaura la media desde el bucket y la comprueba por sha256, construye la web (`VITE_SITE_URL=https://dev.uonify.com`, sin mocks y con noindex), regenera la puerta para ese dist, pasa `edge/test_gate.mjs` (80 pruebas offline) y enseña qué cambiaría, sin escribir nada.
- **Publicar de verdad**: lanzar el workflow a mano sobre `dev` con «publicar» marcado, y solo después del OK visual del Product Owner. Sube los objetos que cambian, sin borrar nunca nada; el bucket tiene versiones. Si la puerta cambia, la prueba en CloudFront DEVELOPMENT y la publica en LIVE. Después sube el `index.html` raíz y las páginas legales, invalida la caché y verifica de punta a punta sin credenciales. Si la verificación falla, vuelve a la puerta anterior.
- Rol de AWS: `uonify-dev-web-github-role`, declarado en mastererp-infrastructure `modules/0-uonify/0.2-app/resources.yml`. Solo lo puede asumir la rama `dev` de este repo. No puede leer el KVS de la puerta (credenciales y clave de las cookies), ni la configuración de la distribución (secreto de origen), ni borrar objetos.
- Las credenciales de la puerta las pone solo el Product Owner, con `edge/set_gate_credentials.sh`. Los cambios de la distribución se hacen a mano con `edge/deploy_edge.mjs`, nunca desde la CI.
- Antes de diseñar o cambiar algo de Google (Gemini/Live, Drive, OAuth), se pide revisión técnica Google AI, y sin veredicto APROBADO no se implementa.
- Ramas, PR, comprobaciones y qué despliega cada fusión: README de 0-uonify.
