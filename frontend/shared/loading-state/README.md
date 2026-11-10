# Estado de carga

`LoadingState` es el indicador de carga común de los listados y detalles de Operaciones (Pedidos, Preparación, Rutas y Nodos) y Catálogo (Productos, Categorías, Atributos, Marcas y Proveedores). Muestra un spinner con un texto anunciado a lectores de pantalla (`role="status"`); `label` permite indicar qué se está cargando. Catálogo reutiliza este componente y su CSS tanto al abrir una ficha como al cargar, buscar o actualizar sus listados; no mantiene otro spinner propio.
