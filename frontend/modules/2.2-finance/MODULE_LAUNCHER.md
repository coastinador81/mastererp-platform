# Lanzador de módulos — Finanzas DEV

El encabezado independiente de Finanzas incorpora un botón de nueve puntos que abre una cuadrícula de módulos. `src/ModuleLauncher.jsx` y `src/moduleLauncher.css` pertenecen a Finanzas; el App Shell lo monta únicamente en modo `independent`. No cambia el encabezado de Uonify.

Conserva el estándar UX/UI: Inter existente, superficies blancas, gris azulado, iconos SVG de línea y colores suaves por dominio. Finanzas indica «Estás aquí». La tarjeta «Uonify · Espacio general» se retiró por decisión de diseño. Inventario, Operaciones, Ecommerce y Transporte habilitan enlaces solo si coinciden módulo habilitado, permiso de lectura y una ruta ya implementada; no se inventan permisos ni destinos.

Escape cierra y devuelve foco al botón; también se cierra con clic fuera, cambio de contexto y al salir con teclado. Enlaces nativos, foco visible y panel adaptable a móvil. No tiene dependencias nuevas.

Los enlaces a Uonify usan únicamente rutas conocidas: no incluyen tokens ni tenant/empresa en la URL, no transfieren la sesión y el destino debe revalidar su propio contexto. Sin sesión local no se habilitan enlaces a otros módulos; la vista de diseño permite revisar sus tarjetas sin fixtures ni bypass en runtime.

Revisión: `npm run dev -- --port 5180 --strictPort` desde esta carpeta; http://127.0.0.1:5180/. La publicación autorizada se realiza en dev mediante los pipelines existentes, sin cambios de backend, SQL ni infraestructura. Build y navegación visual local se verifican separadamente de la autenticación y navegación entre dominios, que no se certifican aquí.

Por decisión de revisión visual, el servidor local y el build DEV (`import.meta.env.DEV` o modo `dev`) muestra once accesos: Inventario, Finanzas, Operaciones, Ecommerce, Servicios, Centro de Agentes, Recursos humanos, Productividad, Punto de venta, Transporte y Seguridad. Los módulos sin acceso son tarjetas sin enlace; «Vista previa» no concede autorización y «Pendiente» indica que este lanzador no tiene una ruta implementada. Los builds fuera de DEV excluyen esta vista completa y mantienen la selección autorizada. No se añaden rutas ni módulos al backend.

Decisión de navegación visual DEV: Catálogo no aparece como acceso principal; se considera dentro de Ecommerce en esta propuesta visual. Esto no mueve carpetas, entidades ni la propiedad funcional de Catálogo y no implementa todavía su navegación interna en Ecommerce. Inventario reutiliza la ruta y el guard vigentes del App Shell (`erp.catalog` + `catalog.inventory.read`); no se sustituye ese contrato por otro identificador sin coordinar la integración.

Plataforma base se excluye del lanzador por decisión de diseño; no se eliminan sus carpetas, recursos ni funciones.
