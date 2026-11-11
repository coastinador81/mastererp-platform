Componentes visuales reutilizables.

`ApplicationHeader.jsx` mantiene la estructura común de cabecera de las
aplicaciones independientes: navegación móvil, identidad de la aplicación,
acciones contextuales, lanzador y acceso o salida de la sesión. Cada aplicación
inyecta únicamente sus acciones autorizadas y conserva su nombre y ruta.

`application-header.css` es la única fuente para altura, espaciado, marca,
disposición de acciones, botón de menú y adaptación móvil de esa cabecera.
Los módulos no deben redefinir `.integrated-header`, `.brand`,
`.context-controls` ni `.menu-toggle`; solo pueden estilizar las acciones que
inyectan en el slot del componente.
