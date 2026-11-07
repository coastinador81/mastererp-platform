# Lanzador de aplicaciones — Ecommerce DEV

El encabezado usa [ModuleLauncher compartido](../../shared/module-launcher/README.md), con `current-app="ecommerce"`. Identifica Ecommerce como sitio actual y enlaza las entradas de Finanzas y Centro de Agentes; los demás módulos permanecen pendientes. Mantiene el mismo catálogo, iconos, diseño y comportamiento que Finanzas.

No cambia el menú interno de Ecommerce, sus APIs, permisos, autenticación ni contexto. El panel no transfiere sesión ni tokens a los otros subdominios. El destino debe validar su acceso. No se añade la tienda pública como aplicación independiente del lanzador.

El pipeline de Ecommerce observa la fuente común. Para la copia estática de Agentes se genera el mismo asset con `node scripts/sync_module_launcher.mjs`; no editar a mano esa copia ni crear otra implementación.
