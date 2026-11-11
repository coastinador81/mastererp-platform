# Instrucciones para interfaces frontend

Estas reglas se heredan por módulos, submódulos, pantallas y aplicaciones de frontend, junto con el AGENTS raíz y las instrucciones del propietario.

Antes de modificar una interfaz, leer [el estándar UX/UI](../docs/UX_UI_STANDARD.md), [el contrato frontend](../docs/FRONTEND_ARCHITECTURE.md), el README afectado y sus padres. Aplicar la composición apropiada a la responsabilidad de la pantalla; la referencia administrativa no convierte un chat o storefront en una tabla.

- Conservar menú blanco, fondo #F6F8FC, acentos azules, Inter local y fallback sans-serif. Texto general #4B5563; secundario #667085.
- Tablas de 14 px, peso 400, texto #667085 en códigos, nombres y celdas; cabecera #F4F7FB y bordes #E8EDF3. Sin negrita ni subrayados permanentes. Títulos #374151, peso 500.
- Usar variables y componentes existentes; consultar los archivos de referencia antes de crear otro tema, paquete de iconos o copia de la fuente. Los fundamentos `--uon-*` y la base administrativa pertenecen a `frontend/shared/ui`; `--finance-*` es un alias de compatibilidad que no debe extenderse en código nuevo. No aplicar `finance-app` para conceder identidad o comportamiento.
- Mantener iconos SVG de línea fina, etiquetas accesibles, hover tenue, foco visible y legibilidad en móvil. Medir contraste de texto normal y foco.
- En filas con ficha, conservar un enlace real en el nombre, teclado/Enter/nueva pestaña y navegación vigente. Respetar selección y controles; evitar columnas de detalle redundantes.
- Verificar contratos antes de añadir búsqueda, filtros, métricas o botones. Nunca incluir fixtures en el runtime como respaldo de un servicio. No presentar un filtro de una sola página como búsqueda completa.
- Conservar autenticación, contexto, permisos, cancelación de respuestas previas y rutas. Menús y estilos no autorizan operaciones.
- Revisar escritorio/móvil, hover/foco y comportamiento pertinente; ejecutar build, validador y git diff --check. Informar si solo se usaron fixtures locales.
- Añadir el resumen y enlace a la guía en el README de nuevos módulos/pantallas. No copiar este AGENTS para crear versiones contradictorias por módulo.

Ante una discrepancia, explicar advertencia, archivo, consecuencia y recomendación; resolver cambios técnicos autorizados dentro del estándar y consultar las decisiones funcionales pendientes al Product Owner. Conservar trabajo ajeno y no publicar ni desplegar por una tarea documental.

Excepción del propietario (08-11-2026), documentada con su alcance: todo lo visual de Uonify (`modules/0-uonify`) y de Finanzas (`modules/2.2-finance`, capa de tema `uonify-brand`, fase 1 visual) se rige por el manual de identidad corporativa de Uonify (`modules/0-uonify/identidad-corporativa/Uonify_Identidad_Corporativa.pdf`). La regla completa está en el `README.md` de la raíz. El resto de interfaces mantiene estas reglas.
