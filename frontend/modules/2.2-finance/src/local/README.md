# Revisión local de Gestión de compras

Propietario: Finanzas → Administración → Gestión de compras. Estado: prototipo visual local, sin backend, SQL, permisos efectivos ni persistencia.

## Entradas Vite DEV

- `/?vista=resumen-compras`: Resumen, primero en el menú. Indicadores sin cifras y tablas vacías; filtros de nodo, fechas y moneda.
- `/?vista=solicitudes-compra`: Compras con doce fixtures DEMO. Búsqueda y filtros de nodo, fechas y moneda.
- `/?vista=ordenes-compra`: Órdenes DEMO con filtros adicionales de estado, origen y entrega prevista.
- `/?vista=sugerencias-compras`: Sugerencias inmediatamente debajo de Compras, con tres fixtures estáticas; no se ejecuta IA ni se consulta Inventario.

Bolívares (Bs.) por defecto; alternativas USD y EUR. No hay Todas las monedas ni conversiones. Nodos de ejemplo identificados. Rangos de fechas invertidos conservan el contenido y muestran error.

## Fichas y navegación

Clic de fila o enlace accesible en referencia abre `compra_demo`, `orden_demo` o `sugerencia_demo`. Se conservan teclado, nueva pestaña y selección de texto. Historial, enlaces directos y recarga para fixtures estáticas. Volver desde la ficha mantiene los filtros en memoria. Fichas de compras/órdenes con proveedor, destino, líneas, importes, condiciones, documentos y trazabilidad. Sin tasas fiscales, condiciones o conversiones inventadas.

Estados de órdenes ilustrativos: Borrador, Pendiente de aprobación, Aprobada, Enviada al proveedor, En tránsito, Recibida parcialmente, Completado y Cancelada. No implementan transiciones reales.

## Sugerencias y dos revisiones

La ficha muestra stock de ejemplo, producto, proveedor, cantidad e importe estimados y observaciones opcionales del Jefe de nodo. Primero el operador del nodo confirma la revisión; después el Jefe de compras aprueba. No existe selector de rol. Las fases secuenciales son visuales: no representan separación autenticada de personas ni permisos.

Las observaciones se conservan al navegar y quedan de solo lectura tras la primera confirmación. La aprobación final abre un borrador DEMO en Compras con origen, nodo, proveedor, cantidad, precio y observaciones conservados. Solo se crea un borrador por sugerencia durante la sesión. No se generan órdenes, deudas, pagos ni movimientos de inventario.

Se registra fecha y hora de ambas confirmaciones por separado (ISO en memoria, presentación local del navegador con segundos). Antes de confirmar aparece Pendiente. No es auditoría de servidor ni un plazo de aprobación.

Recargar borra notas, revisiones y compras generadas. Una referencia generada que ya no existe muestra documento no disponible. No hay localStorage ni llamadas a servicios.

## Preparación y publicación

Desde la raíz de Finanzas: `npm run dev -- --port 5180 --strictPort`. El guard `import.meta.env.DEV` limita este montaje a Vite local, sin parámetros id/accion. `npm run build` excluye el prototipo y sus fixtures; publicar el commit no habilita esta demo en el hosting. El WorkspaceProvider y los CRUD conectados mantienen sus contratos originales fuera del montaje local.

Resumen reutiliza `../../2.2.1-administration/2.2.1.2-gestion-compras/screens/purchases/PurchasesSummary.jsx`. Los archivos de esta carpeta son soporte técnico de diseño, no nuevas rutas funcionales entre capas.

Pendientes: reglas IA, contrato autorizado de stock/nodos, autorización de ambas revisiones, persistencia, auditoría y transición revisada para publicar interfaces funcionales. Consultar el estándar UX/UI y contratos antes de conectar datos.

## Publicación DEMO DEV autorizada

Excepción explícita del propietario: incluir estas pantallas DEMO en el build DEV, aisladas del producto conectado. Abrir `https://finanzas-dev.uonify.com/?demo=compras&vista=resumen-compras`. El parámetro `demo=compras` se conserva en enlaces, fichas e historial. Sin parámetro, las rutas conectadas mantienen su comportamiento y autorización. No se cambia ninguna API ni se usa la demo como fallback ante errores.

El build con modo `dev` incluye esta demostración, identificada permanentemente como DEMO sin datos reales; otros modos no habilitan su entrada. Los ejemplos son públicos y ficticios; las observaciones no se envían ni persisten. No introducir información sensible. Revisiones y borradores siguen en memoria y desaparecen al recargar. Los apartados anteriores que describen exclusión del build son el estado previo a esta autorización.

Recuperación: revertir este commit mediante un nuevo commit en dev y dejar que el pipeline vuelva a publicar. No se alteran hosting, datos o recursos.

Filtro de aprobación en Sugerencias: todas las etapas, pendiente del nodo, pendiente del Jefe de compras o aprobada/pasada a Compras. Se combina con nodo y deriva de las revisiones en memoria; no inventa aprobaciones. Incluye contador, vacío y restablecer. Disponible en la entrada DEMO tras la publicación por el pipeline de Finanzas.

## Revisión con ajustes y prioridad — DEMO DEV

La recomendación original DEMO es inmutable. Jefe de nodo y Jefe de compras pueden aceptar sin cambios o ajustar cantidad, precio estimado y proveedor de la única línea de ejemplo. Los formularios conservan borradores en memoria al navegar; invalidaciones conservan el contenido. Cambiar valores u observaciones exige confirmar nuevamente.

Primera confirmación: se conserva una instantánea del nodo, observaciones y hora. La segunda revisión parte de esa versión. Una modificación del nodo se señala para revisión del Jefe de compras, quien puede ajustar de nuevo, dejar sus observaciones y marcar prioridad explícita (no se impone automáticamente).

El comparativo IA → nodo → Compras muestra cantidad, precio, proveedor y total, con diferencias resaltadas frente a la etapa anterior. Se mantiene después de aprobar en la sugerencia y el borrador de Compras; este último recibe únicamente valores finales. Ambas instantáneas y notas se conservan; el aprobado ya no es editable desde Sugerencias. La prioridad también aparece en listado y ficha.

Límites técnicos del prototipo: unidades enteras positivas hasta 1.000.000, precio positivo hasta 1.000.000 con dos decimales, proveedor de hasta 160 caracteres. Cálculo monetario por céntimos, sin impuestos ni conversión. Estos límites no definen políticas comerciales del backend. La elección de proveedor es texto DEMO, no un maestro conectado. Agregar/quitar productos, reglas IA, identidades, permisos y persistencia siguen pendientes.

No se crea una orden de compra real ni se ejecutan servicios. Todas las versiones se pierden al recargar. La publicación del candidato se realiza mediante el pipeline de Finanzas; no conecta servicios ni persiste datos.
