# Lanzador de aplicaciones — Finanzas DEV

Finanzas usa la [implementación compartida](../../shared/module-launcher/README.md) de Platform. El adaptador técnico `src/ModuleLauncher.jsx` conserva el import existente del App Shell; no contiene otro catálogo ni otra lógica de permisos. Solo identifica `current-app="finance"` y conserva la alineación del encabezado.

El panel muestra las once aplicaciones acordadas. Finanzas indica «Estás aquí»; Ecommerce abre https://ecom-dev.uonify.com/ y Centro de Agentes abre https://agentes-dev.uonify.com/. Las ocho restantes se identifican como pendientes sin enlaces ficticios. No aparecen Uonify, Plataforma base, Operaciones, Recursos humanos ni Seguridad como aplicaciones independientes.

Los enlaces abren entradas de servicios y no dependen de permisos financieros para mostrarse. Cada aplicación valida sus operaciones y datos mediante los contratos existentes. No se transfieren tokens, tenant ni empresa por URL; el lanzador no implementa SSO ni cambia Cognito.

Teclado, foco, Escape, clic fuera y adaptación móvil pertenecen al componente común. Sin dependencias nuevas. La publicación DEV usa el pipeline existente de Finanzas, que observa `frontend/shared/module-launcher/**`.

Validación local: `npm run build` desde esta carpeta y `node scripts/validate_module_launcher_browser.cjs` desde la raíz de Platform. La prueba distingue compilaciones locales de navegación pública en DEV; no acredita login ni operaciones privadas.
