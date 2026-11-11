Componentes visuales reutilizables.

`ApplicationHeader.jsx` mantiene la estructura común de cabecera de las
aplicaciones independientes: navegación móvil, identidad de la aplicación,
acciones contextuales, lanzador y acceso o salida de la sesión. Cada aplicación
inyecta únicamente sus acciones autorizadas y conserva su nombre y ruta.

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
