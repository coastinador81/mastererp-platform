# Espacio de trabajo

Componente visual reutilizable para identificar la aplicación y la sección activa dentro de la navegación existente. Recibe textos e icono por propiedades; no selecciona tenant, empresa ni concede permisos. Cada aplicación conserva su contexto autorizado y sus controles de navegación.

`showSelectedIcon` permite mostrar el icono de la opción activa; es optativo
y conserva el icono anterior para otros consumidores. Ecommerce filtra sus
espacios y rutas por módulos/permisos, navega a la primera vista disponible
y cierra el selector después de elegir. No cambia tenant ni empresa.
