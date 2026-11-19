Componentes visuales reutilizables.

Finanzas es el canon visual y de interacción del shell administrativo.
`ApplicationShell.jsx` empaqueta ese patrón para Ecommerce y Transporte: cabecera unificada,
rail de servicios relacionados (`RelatedServicesRail`), barra lateral colapsable
a iconos con expansión al foco o puntero, capa modal móvil con cierre automático,
área de contenido canónico y panel contextual de Uony. Finanzas conserva su
composición de rutas propia, pero consume los mismos componentes centrales.

`ApplicationHeader.jsx` mantiene la estructura común de cabecera de las
aplicaciones independientes: navegación móvil, identidad de la aplicación,
acciones contextuales, lanzador y acceso o salida de la sesión. Cada aplicación
inyecta únicamente sus acciones autorizadas y conserva su nombre y ruta.

`ApplicationAssistant.jsx`, `ApplicationIcon.jsx` y `UonifyChatLink.jsx` son
extracciones fieles de los componentes aprobados originalmente en Finanzas;
los archivos de Finanzas mantienen reexportaciones compatibles.

`design-tokens.css` expone los fundamentos visuales corporativos que pueden
compartir las aplicaciones sin importar la implementación interna de Uonify.
Los componentes compartidos pueden importarlo directamente; las entradas de
aplicación deben cargarlo antes de sus capas específicas. Los tokens `--uon-*`
son fundamentos, no autorizan copiar la composición chat-first a una pantalla
operativa ni sustituyen la tipografía aprobada de cada canal.
`application-header.css` es la única fuente para altura, espaciado, marca,
disposición de acciones, botón de menú y adaptación móvil de esa cabecera.
`admin-application.css` contiene la base administrativa que antes pertenecía a
Finanzas. Finanzas, Ecommerce y Transporte la consumen sin importarse entre sí;
los alias `--finance-*` permanecen solo para una transición compatible.
Los módulos no deben redefinir `.integrated-header`, `.brand`,
`.context-controls` ni `.menu-toggle`; solo pueden estilizar las acciones que
inyectan en el slot del componente.

## Temas administrativos

Finanzas y Ecommerce activan el tema compartido mediante application-theme.mjs y application-theme.css en sus entradas. ApplicationThemeToggle.jsx se presenta solo para esas aplicaciones en ApplicationHeader. El tema no se activa implicitamente en otros consumidores. Los cambios de layout de cabecera permanecen en application-header.css; los colores pertenecen a tokens de tema. Ver [contrato tecnico y validacion](../../../docs/ADMINISTRATIVE_THEMES.md).
