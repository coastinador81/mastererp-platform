# Aplicación Uonify

Objetivo específico: web de la aplicación de Uonify que se publica en https://dev.uonify.com.

Responsabilidad: interfaz de Uony (chat y voz), Estudio, producto, conexiones, cuenta y cobro, alta, ayuda y web pública.
Estado: código de la web aprobada copiado tal cual del árbol que se publica en dev.uonify.com (08-11-2026). Desde este repo todavía no se publica: dev.uonify.com se sigue publicando con los scripts manuales hasta que exista su workflow propio.

Antes de trabajar aquí, lee el README de [0-uonify](../README.md).

## Contrato y estado de esta capa

Código: 0.2. Nombre/ruta: `0-uonify/0.2-app`. Propietario funcional: Uonify; las decisiones de alcance, comportamiento y aspecto las toma el Product Owner de Uonify. Capa: frontend. Dependencias: backend de `backend/modules/0-uonify/0.2-app`, llamado siempre por rutas relativas `/api`.

Contenido: React con TypeScript y Vite (`package.json`, `package-lock.json`, `src/`, `public/`, `scripts/` y configuración). Son 1.565 ficheros idénticos (sha256) a la web aprobada, más `public-pages/` (páginas legales que sirve la puerta de dev.uonify.com).

Media fuera de git: los 37 ficheros de más de 1 MiB (imágenes, modelos 3D y vídeo; 139 MiB) ya están publicados en el bucket de la web y no se suben. `media-fuera-de-git.sha256` los lista con su sha256: para un build completo, hay que restaurarlos en su ruta y comprobarlos con `shasum -a 256 -c media-fuera-de-git.sha256`.

## Reglas de esta carpeta

- ⚠ La raíz de `frontend/modules/0-uonify` es la app del equipo MasterERP y no se toca. Su workflow `publish-uonify-dev.yml` excluye `frontend/modules/0-uonify/0.2-app/**`, así que los cambios aquí no la republican.
- Aprobación visual previa del Product Owner para cualquier cambio de lo que se ve. Lo aprobado sigue publicado hasta que él apruebe lo nuevo.
- Nada valioso en el navegador: ni claves, ni precios internos, ni identificadores de proveedor. Las llamadas al backend van siempre por `/api` relativo.
- TypeScript estricto. Todo fichero nuevo o modificado tiene como máximo 500 líneas. La excepción del Product Owner (08-11-2026) cubre solo `public/assets/vendor/model-viewer-4.3.1.min.js` (1.118 líneas, librería de terceros).
- Antes de diseñar o cambiar algo de Google (Gemini/Live, Drive, OAuth), se pide revisión técnica Google AI, y sin veredicto APROBADO no se implementa.
- Ramas, PR, comprobaciones y qué despliega cada fusión: README de 0-uonify.
