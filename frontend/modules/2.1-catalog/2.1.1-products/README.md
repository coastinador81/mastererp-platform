# Productos

Objetivo específico: Gestionar identidad y ficha maestra de productos.

Responsabilidad: Productos, dentro de Catálogo.
Estado: candidato funcional no desplegado. Incluye listado/filtros, alta y
edición manual de ficha maestra. No muestra ni modifica stock.


## Contrato y estado de esta capa

Código: 2.1.1. Nombre/ruta: `2.1.1-products`. Objetivo y alcance: los descritos arriba; esta carpeta no amplía las responsabilidades de su módulo padre. Propietario funcional: dominio Catálogo; responsable nominal pendiente de asignación. Propietario de los datos: módulo que define sus entidades; no copiar datos de otros dominios.

Capa: frontend. Dependencias: contexto autenticado, tenant y contratos del padre cuando correspondan; contratos adicionales pendientes de definición. Exclusiones: lógica y recursos de otros módulos; conectores técnicos fuera de Digital Sales. APIs/eventos/MCP: no declarar disponibles por existir esta carpeta; revisar implementación y contrato antes de consumir. Propuestas sin contrato confirmado permanecen pendientes.

Estado verificable: build Vite correcto. La autenticación se obtiene del
proveedor de sesión del app-shell en runtime; no se materializan tokens.

Validaciones: `npm run build` y `scripts/validate_structure.py`. Pendiente:
integración efectiva en app-shell y pruebas E2E posteriores al despliegue.
