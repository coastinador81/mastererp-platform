# Etiqueta de estado

`StatusBadge` muestra estados con la paleta de Operaciones (Pendiente, Confirmado, En preparación, Listo, En ruta, Entregado, Cancelado). Recibe el código del backend en `status` y el texto visible como hijo; `tone` permite forzar el color cuando el estado se deriva en la interfaz. La relación código → color vive en `statusTone.mjs` para que todos los listados usen la misma.
