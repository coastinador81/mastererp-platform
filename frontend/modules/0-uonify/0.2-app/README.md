# Aplicación Uonify

Objetivo específico: web de la aplicación de Uonify que se publica en https://dev.uonify.com.

Responsabilidad: interfaz de Uony (chat y voz), Estudio, producto, conexiones, cuenta y cobro, alta, ayuda y web pública.
Estado: carpeta creada; la web aprobada llega en el siguiente PR. Desde este repo todavía no se publica nada.

Antes de trabajar aquí, lee el README de [0-uonify](../README.md).

## Contrato y estado de esta capa

Código: 0.2. Nombre/ruta: `0-uonify/0.2-app`. Propietario funcional: Uonify; las decisiones de alcance, comportamiento y aspecto las toma el Product Owner de Uonify. Capa: frontend. Dependencias: backend de `backend/modules/0-uonify/0.2-app`, llamado siempre por rutas relativas `/api`.

⚠ La raíz de `frontend/modules/0-uonify` es la app del equipo MasterERP y no se toca. Su workflow `publish-uonify-dev.yml` vigila `frontend/modules/0-uonify/**/*.jsx` y `**/*.tsx`: antes de subir la web aquí hay que excluir `frontend/modules/0-uonify/0.2-app/**` de ese workflow.
