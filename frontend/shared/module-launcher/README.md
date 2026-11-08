# Lanzador compartido de aplicaciones DEV

Fuente oficial: `module-launcher.mjs`. Catálogo fijo de once aplicaciones y un acceso al Chat principal, iconos SVG y Web Component con estilos aislados. `ModuleLauncher.jsx` es el adaptador React usado por Finanzas y Ecommerce. El atributo `current-app` identifica `finance`, `ecommerce`, `inventory` o `agents`; el sitio actual indica «Estás aquí».

Finanzas, Ecommerce, Inventario y Centro de Agentes enlazan a sus entradas DEV verificadas, en la misma pestaña y sin parámetros, tokens ni contexto en la URL. Son entradas de servicios, no concesiones de permisos: cada aplicación conserva su autenticación/autorización. Agentes sigue siendo una landing estática; el lanzador no implementa login, Google, SSO ni funciones de agentes. Los siete módulos restantes se presentan como pendientes, sin enlaces ficticios. Chat principal enlaza a https://dev.uonify.com/ con icono de conversación; no es otro módulo de negocio. No se muestran Plataforma base, Operaciones, RR. HH. ni Seguridad como aplicaciones separadas.

El Web Component reutiliza la identidad visual Inter/blanco/gris azulado, iconos finos y colores suaves. Admite teclado, enlaces nativos/nueva pestaña, Escape con devolución del foco, clic fuera y panel móvil desplazable. No usa datos personales, almacenamiento, llamadas API ni dependencias nuevas.

## Copia estática de Agentes

Infrastructure conserva una copia generada del mismo archivo en `modules/2.6-agent-center/agents-static/shared/`, no otra implementación manual. Desde Platform ejecutar:

```powershell
node scripts/sync_module_launcher.mjs
node scripts/sync_module_launcher.mjs --check
```

El manifiesto registra fuente y SHA-256. El workflow existente de Agentes comprueba la integridad y publica el asset local antes de index.html, con Content-Type JavaScript y caché revalidable. No descarga código de otro dominio en runtime ni necesita nuevas credenciales, permisos o stacks. Las actualizaciones se sincronizan y revisan en ambos repositorios; el commit de Infrastructure fija la versión publicada de su copia.

Los pipelines de Finanzas y Ecommerce observan esta carpeta. Cambiar un icono/enlace no modifica contratos SQL, permisos ni hosting.

Navegación principal: los enlaces de aplicaciones fijan target=_self, por lo que un clic normal sustituye la aplicación en la misma pestaña. Se preserva la apertura voluntaria con Ctrl/Cmd o menú contextual. Finanzas incorpora un icono de chat junto al lanzador para volver a https://dev.uonify.com/ sin tokens ni contexto en la URL. El acceso no implementa SSO ni modifica autorizaciones. Publicación mediante los pipelines DEV propietarios de las aplicaciones.

Inventario está habilitado en el catálogo fuente con https://inventario-dev.uonify.com/. El Chat principal se muestra dentro de la cuadrícula, además del acceso del encabezado financiero. Ambos fijan target=_self y no transfieren contexto ni tokens. La visibilidad de estos accesos se actualiza al publicar los artefactos de cada aplicación mediante sus pipelines.
