# Aplicación Uonify

Objetivo específico: web de la aplicación de Uonify que se publica en https://dev.uonify.com.

Responsabilidad: interfaz de Uony (chat y voz), Estudio, producto, conexiones, cuenta y cobro, alta, ayuda y web pública.
Estado: código de la web aprobada copiado tal cual del árbol que se publica en dev.uonify.com (08-11-2026). Se publica a mano desde un clon de este repo con el usuario AWS del Product Owner (ver «Publicación»); GitHub no publica.

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

Decisión del Product Owner (08-11-2026): se publica con su usuario de AWS, desde un clon de este repo en la rama `dev` y nunca desde un árbol local suelto. GitHub no publica, porque no hay rol de CI. Solo después de su OK visual, desde esta carpeta:

1. Media: restaurar los ficheros de `media-fuera-de-git.sha256` desde el bucket `uonify-dev-web-277352717693` (clave = ruta sin `public/`) y comprobarlos con `shasum -a 256 -c media-fuera-de-git.sha256`.
2. `npm ci` y, sin `VITE_USE_MOCKS`, `VITE_INDEXING` ni `VITE_ESTUDIO_CLIP_WIRING`: `VITE_SITE_URL=https://dev.uonify.com npm run build`.
3. Puerta: `node edge/build_gate.mjs --dist dist --root-gated --write`. Si `edge/gate-default.js` o `edge/public-pages/` cambian, se suben por PR. Después: `node edge/test_gate.mjs`, con `GATE_DIST`, `GATE_FRONT_SRC`, `GATE_BACKEND_SRC` y `GATE_ACORN` apuntando a `dist`, `src`, `backend/modules/0-uonify/0.2-app/app` y `node_modules/acorn`. Tiene que dar 80/80.
4. Ensayo: `node edge/upload_dist.mjs --dist dist`, el mismo con `--root` y `node edge/deploy_edge.mjs legal`.
5. Publicar: `node edge/upload_dist.mjs --dist dist --apply`. Si la puerta cambió, `node edge/deploy_edge.mjs functions --apply` y `publish --apply`. Después, `upload_dist.mjs --dist dist --root --apply` y `deploy_edge.mjs legal --apply`.
6. Verificar: `node edge/deploy_edge.mjs verify`, y prueba por la UI real.

Nunca se borra nada del bucket, que guarda versiones. Las credenciales de la puerta las pone solo el Product Owner, con `edge/set_gate_credentials.sh`. Los cambios de la distribución se hacen con `edge/deploy_edge.mjs`.

- Antes de diseñar o cambiar algo de Google (Gemini/Live, Drive, OAuth), se pide revisión técnica Google AI, y sin veredicto APROBADO no se implementa.
- Ramas, PR, comprobaciones y qué despliega cada fusión: README de 0-uonify.
